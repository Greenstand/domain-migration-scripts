require('dotenv').config();
const ProgressBar = require('progress');
const { Writable } = require('stream');

const ws = Writable({ objectMode: true });
const { knex } = require('../database/knex');
const createGrowerAccount = require('./helper/createGrowerAccount');
const createWalletRegistrations = require('./helper/createWalletRegistrations');

async function migrate() {
  const base_query_string = `SELECT pp.* FROM public.planter pp
    left join treetracker.grower_account tg on pp.grower_account_uuid = tg.id
    where 
      (
        ( pp.email is not null or pp.phone is not null ) 
         and 
        tg.id is null 
      )
        or
      (
        pp.organization_id is not null and tg.organization_id is null
      )
    order by organization_id asc
  `;

  const rowCountResult = await knex.select(
    knex.raw(`count(1) from (${base_query_string}) as src`),
  );
  const recordCount = +rowCountResult[0].count;
  if (!recordCount) {
    console.log('No record left to migrate');
    process.exit(0);
  }
  console.log(`Migrating ${recordCount} records`);

  const bar = new ProgressBar('Migrating [:bar] :percent :etas', {
    width: 100,
    total: recordCount,
  });

  const trx = await knex.transaction();

  ws._write = async (planter, enc, next) => {
    try {
      if (planter.grower_account_uuid) {
        // update organization_id
        if (planter.organization_id) {
          const org = await trx
            .select()
            .table('entity')
            .where({ id: planter.organization_id })
            .first();

          const organization_id = org.stakeholder_uuid;

          await trx('treetracker.grower_account')
            .where({ id: planter.grower_account_uuid })
            .update({
              organization_id,
            });
        }

        bar.tick();
        if (bar.complete) {
          await trx.commit();
          console.log('Migration Complete');
          process.exit();
        }
        return next();
      }

      if (planter.email || planter.phone) {
        const planterRegistrations = await trx
          .select()
          .table('public.planter_registrations')
          .where('planter_id', planter.id)
          .orderBy('created_at', 'desc');

        const {
          id: growerAccountId,
          wallet,
          alreadyExists,
        } = await createGrowerAccount(
          {
            planter,
            planterRegistrations,
          },
          trx,
        );

        if (!alreadyExists) {
          await createWalletRegistrations(
            {
              planter,
              planterRegistrations,
              growerAccountId,
              wallet,
            },
            trx,
          );
        }
      }

      bar.tick();
      if (bar.complete) {
        await trx.commit();
        console.log('Migration Complete');
        process.exit();
      }
    } catch (e) {
      console.log(e);
      console.log(`Error processing planter id ${planter.id} ${e}`);
      await trx.rollback();
      process.exit(1);
    }
    next();
  };

  const query_stream = knex.raw(`${base_query_string}`).stream();
  query_stream.pipe(ws);
}

migrate();
