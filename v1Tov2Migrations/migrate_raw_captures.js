require('dotenv').config();
const ProgressBar = require('progress');
const { Writable } = require('stream');

const ws = Writable({ objectMode: true });
const { knex } = require('../database/knex');
const createCorrespondingWalletRegistration = require('./helper/createCorrespondingWalletRegistration');
const createDeviceConfiguration = require('./helper/createDeviceConfiguration');
const createRawCapture = require('./helper/createRawCapture');
const createSession = require('./helper/createSession');

async function migrate() {
  try {
    // filter out trees with invalid planter_id
    const base_query_string = `
      select 
        t.* 
      from 
        public.trees t 
        join planter p on t.planter_id = p.id 
        left join field_data.raw_capture r on t.uuid = r.id :: text 
      where 
        (
          r.id is null 
          and t.image_url is not null 
          and (
            p.email is not null 
            or p.phone is not null
          ) 
          and t.planter_id NOT IN (825, 1253, 1214)
        ) 
        or (
          r.id is not null and
          (
            (
              t.active = false 
              and r.status != 'rejected'
            ) 
            or (
              t.active = true 
              and t.approved = true 
              and r.status != 'approved'
            )
          )
        ) 
      order by 
        t.id asc
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

    const bar = new ProgressBar(
      'Migrating [:bar] :percent :etas :current/:total (:rate)',
      { width: 40, total: recordCount },
    );

    const trx = await knex.transaction();
    ws._write = async (tree, enc, next) => {
      try {
        const planter = await trx
          .select()
          .table('public.planter')
          .where('id', tree.planter_id)
          .first();
        const planter_registrations = await trx
          .select()
          .table('public.planter_registrations')
          .where('planter_id', tree.planter_id)
          .orderBy('created_at', 'desc');

        let device = null;
        const planter_identifier = planter.phone || planter.email;
        let { device_identifier } = tree;
        const { device_id } = tree;

        if (device_id) {
          device = await trx
            .select()
            .table('public.devices')
            .where('id', tree.device_id)
            .first();

          device_identifier = device.android_id;
        } else if (device_identifier) {
          device = await trx
            .select()
            .table('public.devices')
            .where('android_id', device_identifier)
            .first();
        }

        // WALLET REGISTRATION
        const { walletRegistrationId, organization } =
          await createCorrespondingWalletRegistration(
            {
              planter,
              planter_registrations,
              tree: {
                planter_identifier,
                device_identifier,
              },
              growerAccountId: planter.grower_account_uuid,
            },
            trx,
          );

        // DEVICE CONFIGURATION
        const deviceConfigurationId = await createDeviceConfiguration(
          device,
          trx,
        );

        // SESSION
        const sessionId = await createSession(
          {
            organization,
            walletRegistrationId,
            deviceConfigurationId,
            organizationId: tree.planting_organization_id,
          },
          trx,
        );

        // RAW CAPTURE
        const treeAttributes = await trx
          .select()
          .table('public.tree_attributes')
          .where('tree_id', +tree.id);

        await createRawCapture(tree, treeAttributes, sessionId, trx);

        bar.tick();
        if (bar.complete) {
          await trx.commit();
          console.log('Migration Complete');
          process.exit();
        }
      } catch (e) {
        console.log(e);
        console.log(`Error processing tree id ${tree.id} ${e}`);
        await trx.rollback();
        process.exit(1);
      }
      next();
    };

    const query_stream = knex.raw(`${base_query_string}`).stream();
    query_stream.pipe(ws);
  } catch (err) {
    console.log(err);
  }
}

migrate();
