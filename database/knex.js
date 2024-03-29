const connection = process.env.DATABASE_URL;
const postgresPattern = /^postgresql:\//;

if (!postgresPattern.test(connection)) {
  throw new Error('invalid database connection url received');
}

const knexConfig = {
  client: 'pg',
  debug: process.env.NODE_LOG_LEVEL === 'debug',
  connection,
  pool: { min: 0, max: 50 },
  acquireConnectionTimeout: 300000,
};

const knex = require('knex')(knexConfig);

const sourceDB = require('knex')({
  ...knexConfig,
  connection: process.env.SOURCE_DB,
});

const targetDB = require('knex')({
  ...knexConfig,
  connection: process.env.TARGET_DB,
});

module.exports = { knex, sourceDB, targetDB };
