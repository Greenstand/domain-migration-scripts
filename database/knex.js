const expect = require("expect-runtime");
const connection = process.env.DATABASE_URL
expect(connection).to.match(/^postgresql:\//);
const urlregexp = /postgresql:\/\/(.+):(.+)@(.+):(\d+)\/(.+)\?ssl=true/g;
const dbConnValues = [...connection.matchAll(urlregexp)][0];

let knexConfig = {
  client: "pg",
  debug: process.env.NODE_LOG_LEVEL === "debug" ? true : false,
  connection: {
    host: dbConnValues[3],
    user: dbConnValues[1],
    password: dbConnValues[2],
    database: dbConnValues[5],
    port: dbConnValues[4],
    ssl: { rejectUnauthorized: false }
  },
  pool: { min: 0, max: 10 },
};

const knex = require("knex")(knexConfig);

module.exports = { knex };
