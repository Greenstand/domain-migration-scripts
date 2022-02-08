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
const generate_uuid_v4 = require("uuid").v4;

const { knex } = require("./database/knex");
const Writable = require("stream").Writable;
const ws = Writable({ objectMode: true });
const ProgressBar = require("progress");

const TEMPORARY_DEVICE_CONFIG_ID = "3cd6ff18-b0a7-41f2-bda2-f73daf1d6674";

async function ensureGrowerAccountExists(legacyTree, transaction) {
  let planter = null;
  if (!legacyTree.planter_identifier && !legacyTree.planter_id) {
    throw Error("No planter record found in legacy tree table");
  }
  if (legacyTree.planter_id) {
    planter = await transaction
      .select(
        `public.planter.id as id`,
        `public.planter.first_name as first_name`,
        `public.planter.last_name as last_name`,
        `public.planter.email as email`,
        `public.planter.organization as organization`,
        `public.planter.phone as phone`,
        `public.planter.image_url as image_url`,
        `public.planter.person_id as person_id`,
        `public.planter.organization_id as organization_id`,
        `public.planter.image_rotation as image_rotation`,
        `public.planter_registrations.created_at as created_at`
      )
      .table("public.planter")
      .leftJoin("public.planter_registrations", "public.planter.id", "public.planter_registrations.planter_id")
      .where("public.planter.id", legacyTree.planter_id)
      .orderBy("created_at", "desc")
      .limit(1)
      .first();
  } else if (
    legacyTree.planter_identifier &&
    legacyTree.planter_identifier.trim()
  ) {
    planter = await transaction
      .select()
      .table("public.planter")
      .leftJoin("public.planter_registrations", "public.planter.id", "public.planter_registrations.planter_id")
      .where("email", legacyTree.planter_identifier)
      .orWhere("phone", legacyTree.planter_identifier)
      .orderBy("created_at", "desc")
      .limit(1)
      .first();
  }
  // console.log(`planter is ${JSON.stringify(planter)}`);
  if (!planter) {
    throw Error(
      `No planter record found for tree entry with id ${legacyTree.id}`
    );
  }
  
  let growerAccount = null;
  if (planter.email || planter.phone) {
    growerAccount = await transaction("treetracker.grower_account")
    .where("wallet", planter.email ?? null)
    .orWhere("wallet", planter.phone ?? null)
    .first();
    console.log(`grower account lookup result ${growerAccount}`)
  }
  if (!growerAccount) {
    console.log(
      `GrowerAccount not found...populating grower account for ${legacyTree.planter_identifier}`
    );
   
    let growerAccounts = await transaction("treetracker.grower_account").insert(
      {
        name: planter.first_name + " " + planter.last_name,
        email: planter.email,
        phone: planter.phone,
        image_url: planter.image_url ?? legacyTree.planter_photo_url,
        image_rotation: planter.image_rotation ?? 0,
        // organization_id: planter.organization_id,
        wallet: planter.email ?? planter.phone ?? legacyTree.planter_identifier,
        first_registration_at: planter.created_at,
      },
      [
        "id",
        "name",
        "email",
        "phone",
        "organization_id",
        "image_url",
        "image_rotation"
      ]
    );
    growerAccount = growerAccounts[0];
  }
  return growerAccount;
}

async function migrate() {
  try {
    const base_query_string = `select t.* from public.trees t left join treetracker.capture c on t.id = c.reference_id
                                where t.active=true and t.approved=true and t.image_url is not null and
                                c.reference_id is null`;
    const rowCountResult = await knex.select(
      knex.raw(`count(1) from (${base_query_string}) as src`)
    );
    console.log(`Migrating ${+rowCountResult[0].count} records`);

    const bar = new ProgressBar("Migrating [:bar] :percent :etas", {
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
        grower_account_id: growerAccount.id,
        gps_accuracy: gps_accuracy,
        morphology: morphology,
        age: isNaN(age) ? 0:age,
        note: note,
        attributes: attributesFormatter(treeAttributes),
        created_at: time_created,
        updated_at: time_updated,
        device_configuration_id: TEMPORARY_DEVICE_CONFIG_ID, //To be populated with field_data.device_configuration_id later
        session_id: generate_uuid_v4(), // Concept of session doesn't exist for legacy data
      });
    };

    ws._write = async (legacyTree, enc, next) => {
      const transaction = await knex.transaction();
      try {
        const growerAccount = await ensureGrowerAccountExists(
          legacyTree,
          transaction
        );
        const treeAttributes = await transaction
          .select()
          .table("public.tree_attributes")
          .where("tree_id", legacyTree.id);

        const captureToInsert = createCapture(
          legacyTree,
          treeAttributes,
          growerAccount
        );
        const { lat, lon } = captureToInsert;
        //console.log(`Capture to Insert ${JSON.stringify(captureToInsert)}`);
        await transaction.raw(
          `insert into treetracker.capture (
            reference_id, image_url, lat, lon, gps_accuracy, grower_account_id, 
            morphology, age, note, attributes, created_at, updated_at, captured_at, device_configuration_id, session_id,
            estimated_geometric_location, estimated_geographic_location 
          )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ST_PointFromText(?, 4326), ST_SetSRID(ST_Point(?, ?), 4326))`,
          [
            captureToInsert.reference_id,
            captureToInsert.image_url,
            captureToInsert.lat,
            captureToInsert.lon,
            captureToInsert.gps_accuracy,
            captureToInsert.grower_account_id,
            captureToInsert.morphology,
            captureToInsert.age,
            captureToInsert.note,
            captureToInsert.attributes,
            captureToInsert.created_at,
            captureToInsert.updated_at,
            captureToInsert.created_at,
            captureToInsert.device_configuration_id,
            captureToInsert.session_id,
            "POINT(" + lon + " " + lat + ")",
            lon,
            lat
          ]
        );
        transaction.commit();
      } catch (e) {
        console.log(`Error processing tree id ${legacyTree.id} ${e}`);
        transaction.rollback();
      }
      bar.tick();
      if (bar.complete) {
        console.log("Migration Complete");
      }
      next();
    };


    if (rowCountResult[0].count > 0) {
      console.log(`begin migration...`)
      const stream = knex.raw(`${base_query_string}`).stream();
      stream.pipe(ws);
    }
  } catch (err) {
    console.log(err);
  }
}

migrate();
