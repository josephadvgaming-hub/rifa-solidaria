require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
 console.error('Faltan DATABASE_URL o SESSION_SECRET en el entorno'); process.exit(1);
}
const production = process.env.NODE_ENV === 'production';
const pool = new Pool({connectionString:process.env.DATABASE_URL,ssl:production?{rejectUnauthorized:false}:false});
const app = express();
if(production) app.set('trust proxy',1);
app.set('view engine','ejs');
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.urlencoded({extended:false,limit:'25kb'}));
app.use(express.static(path.join(__dirname,'public')));
app.use(session({store:new PgSession({pool,createTableIfMissing:true}),secret:process.env.SESSION_SECRET,resave:false,saveUninitialized:false,cookie:{httpOnly:true,secure:production,sameSite:'lax',maxAge:8*60*60*1000}}));
app.use((req,res,next)=>{
 if(!req.session.csrf) req.session.csrf=crypto.randomBytes(24).toString('hex');
 res.locals.csrf=req.session.csrf;
 res.locals.user=req.session.user||null;
 res.locals.message=req.session.message||null;
 delete req.session.message;
 next();
});
function message(req,text){req.session.message=text;}
function csrf(req,res,next){if(req.body._csrf!==req.session.csrf)return res.status(403).send('Formulario inválido. Recarga la página.');next();}
function auth(req,res,next){if(!req.session.user)return res.redirect('/login');next();}
function admin(req,res,next){if(req.session.user?.role!=='admin')return res.status(403).send('Acceso denegado');next();}
function validTicket(letter,number){return /^[A-Z]$/.test(letter)&&Number.isInteger(number)&&number>=1&&number<=100;}
const money=n=>'$'+Number(n).toLocaleString('es-CL');
app.locals.money=money;
app.get('/login',(req,res)=>res.render('login'));
app.post('/login',csrf,async(req,res,next)=>{try{
 const username=String(req.body.username||'').trim().toLowerCase();
 const {rows}=await pool.query('SELECT * FROM users WHERE username=$1 AND active=true',[username]);
 const user=rows[0];
 if(!user||!await bcrypt.compare(String(req.body.password||''),user.password_hash)){message(req,'Usuario o contraseña incorrectos');return res.redirect('/login');}
 req.session.regenerate(err=>{if(err)return next(err);req.session.user={id:user.id,username:user.username,role:user.role};req.session.csrf=crypto.randomBytes(24).toString('hex');res.redirect('/');});
}catch(e){next(e)}});
app.post('/logout',csrf,(req,res)=>req.session.destroy(()=>res.redirect('/login')));
app.get('/',auth,async(req,res,next)=>{try{
 const stats=await pool.query("SELECT status,COUNT(*)::int AS qty FROM tickets GROUP BY status");
 const letters=await pool.query("SELECT letter, COUNT(*) FILTER (WHERE status='available')::int AS available, COUNT(*) FILTER (WHERE status='reserved')::int AS reserved, COUNT(*) FILTER (WHERE status='paid')::int AS paid FROM tickets GROUP BY letter ORDER BY letter");
 const summary=Object.fromEntries(stats.rows.map(x=>[x.status,x.qty]));
 res.render('dashboard',{summary,letters:letters.rows});
}catch(e){next(e)}});
app.get('/rifa/:letter',auth,async(req,res,next)=>{try{
 const letter=String(req.params.letter||'').toUpperCase();
 if(!/^[A-Z]$/.test(letter))return res.status(404).send('Rifa inexistente');
 const {rows}=await pool.query('SELECT t.*,u.username AS seller FROM tickets t LEFT JOIN users u ON u.id=t.seller_id WHERE letter=$1 ORDER BY number',[letter]);
 res.render('tickets',{letter,tickets:rows});
}catch(e){next(e)}});
app.post('/tickets/reserve',auth,csrf,async(req,res,next)=>{
 const letter=String(req.body.letter||'').toUpperCase();
 const nums=[...new Set(String(req.body.numbers||'').split(',').map(s=>Number(s.trim())))];
 const buyer=String(req.body.buyer_name||'').trim();
 const phone=String(req.body.buyer_phone||'').trim();
 if(!/^[A-Z]$/.test(letter)||!nums.length||nums.length>100||nums.some(n=>!validTicket(letter,n))||buyer.length<2||buyer.length>120||phone.length<5||phone.length>40){message(req,'Revisa los números y los datos del comprador');return res.redirect('/rifa/'+( /^[A-Z]$/.test(letter)?letter:'A'));}
 const client=await pool.connect();
 try{
 await client.query('BEGIN');
 const {rows}=await client.query('SELECT number,status FROM tickets WHERE letter=$1 AND number=ANY($2::smallint[]) FOR UPDATE',[letter,nums]);
 if(rows.length!==nums.length||rows.some(t=>t.status!=='available')){await client.query('ROLLBACK');message(req,'Uno o más números ya no están disponibles. No se guardó la venta.');return res.redirect('/rifa/'+letter);}
 for(const n of nums){
 await client.query("UPDATE tickets SET status='reserved',buyer_name=$1,buyer_phone=$2,seller_id=$3,updated_at=NOW() WHERE letter=$4 AND number=$5",[buyer,phone,req.session.user.id,letter,n]);
 await client.query("INSERT INTO audit_log(letter,number,actor_id,action,previous_status,new_status) VALUES($1,$2,$3,'reserve','available','reserved')",[letter,n,req.session.user.id]);
 }
 await client.query('COMMIT');message(req,`Se reservaron ${nums.length} número(s) para ${buyer}.`);res.redirect('/rifa/'+letter);
 }catch(e){await client.query('ROLLBACK');next(e)}finally{client.release()}
});
app.post('/tickets/:letter/:number/:action',auth,csrf,async(req,res,next)=>{
 const letter=String(req.params.letter||'').toUpperCase(),number=Number(req.params.number),action=req.params.action;
 if(!validTicket(letter,number)||!['pay','release'].includes(action))return res.status(400).send('Solicitud inválida');
 const client=await pool.connect();
 try{
 await client.query('BEGIN');
 const {rows}=await client.query('SELECT * FROM tickets WHERE letter=$1 AND number=$2 FOR UPDATE',[letter,number]);
 const ticket=rows[0];
 if(!ticket||ticket.status!=='reserved'||(req.session.user.role!=='admin'&&Number(ticket.seller_id)!==Number(req.session.user.id))){await client.query('ROLLBACK');message(req,'No tienes permiso o el número ya cambió de estado.');return res.redirect('/rifa/'+letter);}
 const newStatus=action==='pay'?'paid':'available';
 if(action==='pay')await client.query("UPDATE tickets SET status='paid',updated_at=NOW() WHERE letter=$1 AND number=$2",[letter,number]);
 else await client.query("UPDATE tickets SET status='available',buyer_name=NULL,buyer_phone=NULL,seller_id=NULL,updated_at=NOW() WHERE letter=$1 AND number=$2",[letter,number]);
 await client.query('INSERT INTO audit_log(letter,number,actor_id,action,previous_status,new_status) VALUES($1,$2,$3,$4,$5,$6)',[letter,number,req.session.user.id,action,ticket.status,newStatus]);
 await client.query('COMMIT');message(req,action==='pay'?'Pago confirmado':'Reserva liberada');res.redirect('/rifa/'+letter);
 }catch(e){await client.query('ROLLBACK');next(e)}finally{client.release()}
});
app.get('/admin/users',auth,admin,async(req,res,next)=>{try{const {rows}=await pool.query('SELECT id,username,role,active,created_at FROM users ORDER BY id');res.render('users',{users:rows});}catch(e){next(e)}});
app.post('/admin/users',auth,admin,csrf,async(req,res,next)=>{try{
 const username=String(req.body.username||'').trim().toLowerCase(),password=String(req.body.password||'');
 if(!/^[a-z0-9_.-]{3,60}$/.test(username)||password.length<10){message(req,'Usuario inválido o contraseña menor a 10 caracteres');return res.redirect('/admin/users');}
 const hash=await bcrypt.hash(password,12);
 await pool.query("INSERT INTO users(username,password_hash,role) VALUES($1,$2,'seller')",[username,hash]);message(req,'Vendedor creado');res.redirect('/admin/users');
 }catch(e){if(e.code==='23505'){message(req,'Ese usuario ya existe');return res.redirect('/admin/users')}next(e)}});
app.post('/admin/users/:id/toggle',auth,admin,csrf,async(req,res,next)=>{try{
 const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id===Number(req.session.user.id))return res.status(400).send('No puedes bloquear tu propia cuenta');
 await pool.query("UPDATE users SET active=NOT active WHERE id=$1 AND role='seller'",[id]);message(req,'Estado actualizado');res.redirect('/admin/users');
}catch(e){next(e)}});
// Revoca sesiones de cuentas desactivadas en cada petición protegida.
app.use((err,req,res,next)=>{console.error(err);res.status(500).send('Ocurrió un error. Intenta nuevamente.');});
async function start(){
 const sql=fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8');await pool.query(sql);
 if(process.env.ADMIN_USER&&process.env.ADMIN_PASSWORD){
  const username=process.env.ADMIN_USER.toLowerCase();
  const found=await pool.query('SELECT id FROM users WHERE username=$1',[username]);
  if(!found.rowCount){if(process.env.ADMIN_PASSWORD.length<10)throw new Error('ADMIN_PASSWORD debe tener al menos 10 caracteres');await pool.query("INSERT INTO users(username,password_hash,role) VALUES($1,$2,'admin')",[username,await bcrypt.hash(process.env.ADMIN_PASSWORD,12)]);console.log('Administrador inicial creado');}
 }
 app.listen(process.env.PORT||3000,()=>console.log('Rifa solidaria en puerto '+(process.env.PORT||3000)));
}
start().catch(e=>{console.error(e);process.exit(1)});
