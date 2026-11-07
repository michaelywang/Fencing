// Point every server module at the dedicated test database.
const url = process.env.TEST_DATABASE_URL ?? "postgres://fencing:fencing@localhost:5432/fencing_test";
process.env.DATABASE_URL = url;
process.env.DATABASE_URL_UNPOOLED = url;
process.env.SETUP_TOKEN = "test-setup-token-0123456789abcdef";
delete process.env.RECOVERY_TOKEN;
delete process.env.SMTP_HOST;
