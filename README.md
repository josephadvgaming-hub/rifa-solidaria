# Rifa solidaria — versión inicial

## Requisitos
- Node.js 20 o superior
- PostgreSQL instalado y ejecutándose

## Instalación local (Windows)
1. Crea una base de datos vacía llamada `rifa_solidaria` en pgAdmin 4.
2. Copia `.env.example` a `.env` y cambia `DATABASE_URL`, `SESSION_SECRET` y `ADMIN_PASSWORD`.
3. Abre una terminal en esta carpeta y ejecuta `npm install`.
4. Ejecuta `npm start`.
5. Abre `http://localhost:3000`.
6. Ingresa con el usuario y contraseña definidos como `ADMIN_USER` y `ADMIN_PASSWORD`.
7. Desde **Administrar vendedores**, crea cuentas para familiares y amigos.

Las tablas se crean automáticamente al iniciar el servidor; no necesitas ejecutar `schema.sql` a mano.

## Railway
Crea un proyecto independiente con servicio Node.js y base de datos PostgreSQL. Configura `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_USER`, `ADMIN_PASSWORD` y `NODE_ENV=production`. Usa `npm start` como comando de inicio. No subas el archivo `.env` a GitHub.

## Funcionamiento
- Rifas A–Z, números 01–100; 2.600 participaciones a $1.000 cada una.
- Cada número se reserva para un comprador y puede confirmarse como pagado o liberarse manualmente.
- Solo el vendedor que hizo la reserva o un administrador puede modificarla.
- El panel muestra los totales de todas las rifas.
- Las operaciones de reserva utilizan transacciones y bloqueo de filas para evitar números duplicados.
- Los números pagados no se pueden liberar desde esta versión.
- Esta versión permite reservar varios números de **una misma letra** por operación. Para vender letras distintas se realizan registros separados.

## Pendiente para próximas versiones
- Registro de ventas multi-letra en una sola operación.
- Historial de ventas por vendedor y exportación.
- Comprobantes, sorteo y configuración de premios.
- Edición de compradores, recuperación de contraseñas y reportes avanzados.
- Verificación de teléfono y protección adicional ante intentos de inicio de sesión automatizados.

## Seguridad
Usa contraseñas fuertes, HTTPS en producción, una clave de sesión larga y respaldos periódicos de PostgreSQL. No compartas cuentas. Comprueba requisitos legales de la rifa y entrega aviso de privacidad a compradores antes de captar datos personales.
