/**
 *  This is a migration script that is to get all the records from legacy `public.tree` and populate 
 *  table `treetracker.capture` as long as the legacy records in `public.trees` are approved,
 *  active, has a valid image url and if legacy data has not made it to capture table already. 
 *  In addition, if the concept of planter referenced in legacy trees table is not found in the 
 *  `treetracker.grower_account`, it is created first using the data from `public.planter` before proceeding
 *  with populating the `treetracker.captures` table.
 * 
 *  @created Jan 28 2022
 *
 * */

require("dotenv").config();
const generate_uuid_v4 = require('uuid').v4;

const { knex } = require("./database/knex");
const Writable = require('stream').Writable;
const ws = Writable({ objectMode: true });
const ProgressBar = require("progress");


async function ensureGrowerAccountExists(legacyTree, transaction) {
  let planter = null;
  if (!legacyTree.planter_identifier && !legacyTree.planter_id) {
     throw Error("No planter record found in legacy tree table");
  }
  if (legacyTree.planter_id) {
    planter = await transaction
            .select()
            .table('public.planter')
            .where('id', legacyTree.planter_id)
            .first();
  } else if(legacyTree.planter_identifier && legacyTree.planter_identifier.trim()) {
    planter = await transaction
            .select()
            .table('public.planter')
            .where('email', legacyTree.planter_identifier)
            .orWhere('phone', legacyTree.planter_identifier)
            .first();
  }
  if (!planter) {
    throw Error(`No planter record found for tree entry with id ${legacyTree.id}`);
  }
  let growerAccount = await transaction('treetracker.grower_account')
                      .where('email', planter.email)
                      .orWhere('phone', planter.phone)
                      .first();
  if (!growerAccount) {
    console.log(`GrowerAccount not found for planter_identifier ${legacyTree.planter_identifier}`);
    console.log(`Populating grower account for ${legacyTree.planter_identifier}`);
    // status, first_registration_at aren't available in the source `public.planter` table
    // Is it ok, if the above attributes take the db defaults?
    growerAccount = await transaction('treetracker.grower_account').insert({
      name: planter.first_name + ' '+planter.last_name,
      email: planter.email,
      phone: planter.phone,
      image_url: planter.image_url ?? legacyTree.planter_photo_url,  //should this be public.trees.planter_photo_url?
      image_rotation: planter.image_rotation ?? 0,
      organization_id: planter.organization_id,
      wallet_id: generate_uuid_v4(), // TODO: temporary workaround, needs to be a specific uuid and not a newly generated one.
      wallet: "Temporary placeholder",
      first_registration_at: new Date()
    }, ['id', 'wallet_id', 'name', 'email', 'phone', 'organization_id', 'image_url', 'image_rotation']);
  }
  console.log(`GrowerAccount exists: ${JSON.stringify(growerAccount)}`);
  return growerAccount
}

ws._write = async (legacyTree, enc, next) => {
  const transaction = await knex.transaction();
  try {
    let growerAcount = await ensureGrowerAccountExists(legacyTree, transaction);
    const treeAttributes = await trx
      .select()
      .table("public.tree_attributes")
      .where("tree_id", +legacyTree.id);

    const captureToInsert = createCapture(legacyTree, treeAttributes, growerAccount);
    const { lat, lon } = captureToInsert;
    await transaction.raw(
      `insert into treetracker.capture (
        reference_id, image_url, lat, lon, gps_accuracy, grower_id, grower_photo_url, grower_username,
        morphology, age, note, attributes, created_at, updated_at, device_configuration_id, session_id,
        estimated_geometric_location, estimated_geographic_location 
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ST_PointFromText(?, 4325), ST_SetSRID(ST_PointFromText(?, 4326)))`,
      [ captureToInsert.id, captureToInsert.image_url, captureToInsert.lat, captureToInsert.lon, captureToInsert.gps_accuracy,
        captureToInsert.grower_id, captureToInsert.grower_photo_url, captureToInsert.grower_username,  captureToInsert.morphology,
        captureToInsert.age, captureToInsert.note, captureToInsert.attributes, captureToInsert.created_at,
        captureToInsert.updated_at, captureToInsert.device_configuration_id, captureToInsert.session_id,
        "POINT(" + lon + " " + lat + ")", "POINT(" + lon + " " + lat +")"]);
    transaction.commit();
    bar.tick();
    if (bar.complete) {
      console.log("Migration Complete");
    }
  } catch (e) {
    console.log(`Error processing tree id ${legacyTree.id} ${e}`);
    transaction.rollback();
  }
  next();
}
    
async function migrate() {
  try {
    const base_query_string = `select t.* from public.trees t left join treetracker.capture c on t.id = c.reference_id
                                where t.active=true and t.approved=true and t.image_url != null and
                                c.reference_id is null`;
    const rowCountResult = await knex.select(knex.raw(`count(1) from (${base_query_string}) as src`));
    console.log(`Migrating ${+rowCountResult[0].count} records`);
    
    var bar = new ProgressBar("Migrating [:bar] :percent :etas", {
      width: 20,
      total: +rowCountResult[0].count,
    });

    const attributesFormatter = (attributes) => {
      if (attributes.length <= 0) return null;
      const attributes_in_json_format = { entries: [] };
      for (let entry of attributes) {
        attributes_in_json_format.entries.push(entry);
      }
      return attributes_in_json_format;
    };

    const createCapture = (
      {
        id,
        time_created,
        planter_photo_url,
        gps_accuracy,
        image_url,
        lat,
        lon,
        morphology,
        age,
        note,
        time_updated,
      },
      treeAttributes,
      growerAccount
    ) => {
      return Object.freeze({
        reference_id: id,
        image_url: image_url,
        lat: lat,
        lon: lon,
        gps_accuracy: gps_accuracy,
        grower_id: growerAccount.id,
        grower_photo_url: planter_photo_url,
        grower_username: '-', //TODO: What should be used for username here?
        morphology: morphology,
        age: age,
        note: note,
        attributes: attributesFormatter(treeAttributes),
        created_at: time_created,
        updated_at: time_updated,
        device_configuration_id: uuid_generate_v4(), // should this take value of device_identifier
        session_id: uuid_generate_v4(), // TODO: Is this appropriate to generate uuid here?
      });
    };

    if (rowCountResult > 0) {
      const stream = knex.raw(`${base_query_string}`).stream();
      stream.pipe(ws);
    } 
  } catch (err) {
    console.log(err);
  }
}

migrate();