require("dotenv").config();
const { knex } = require("./database/knex");
const Writable = require('stream').Writable;
const ws = Writable({ objectMode: true });
const ProgressBar = require("progress");

async function migrate() {
  try {
    const base_query_string =
      "select t.* from public.trees t left join field_data.raw_capture r on t.uuid = r.id::text where t.approved=true and r.id is null";
    const rowCountResult = await knex.select(knex.raw(`count(1) from (${base_query_string}) as src`));
    console.log(`Migrating ${+rowCountResult[0].count} records`);
    
    var bar = new ProgressBar("Migrating [:bar] :percent :etas", {
      width: 20,
      total: +rowCountResult[0].count,
    });

    const attributes_formatter = (attributes) => {
      if (attributes.length <= 0) return null;
      const attributes_in_json_format = { entries: [] };
      for (let entry of attributes) {
        attributes_in_json_format.entries.push(entry);
      }
      return attributes_in_json_format;
    };

    const create_target_objects = (
      {
        uuid,
        time_created,
        device_identifier,
        planter_id,
        planter_photo_url,
        planter_identifier,
        gps_accuracy,
        image_url,
        lat,
        lon,
        note,
        id,
        rejection_reason,
        time_updated,
      },
      tree_attributes
    ) => {
      const base_target_object = Object.freeze({
        id: uuid,
        attributes: attributes_formatter(tree_attributes),
        capture_taken_at: time_created,
        created_at: time_created,
        device_identifier,
        field_user_id: planter_id,
        field_username: planter_identifier,
        lat,
        lon,
        updated_at: time_updated,
      });

      const raw_capture_to_insert = Object.freeze({
        ...base_target_object,
        field_user_photo_url: planter_photo_url,
        gps_accuracy,
        image_url,
        reference_id: id,
        rejection_reason,
        status: "approved",
        note,
      });
      return {
        raw_capture_to_insert,
        raw_capture_feature_to_insert: base_target_object,
      };
    };

   
    ws._write = async (tree_object, enc, next) => {
      const trx = await knex.transaction();
      try {
        if (!tree_object.planter_identifier && tree_object.planter_id) {
          const planter = await trx
            .select()
            .table("public.planter")
            .where("id", tree_object.planter_id)
            .first();
          tree_object.planter_identifier = planter.email ?? planter.phone;
        }
        const tree_attributes = await trx
          .select()
          .table("public.tree_attributes")
          .where("tree_id", +tree_object.id);

        const { raw_capture_to_insert, raw_capture_feature_to_insert } =
          create_target_objects(tree_object, tree_attributes);

        //field_data.raw_capture insertion
        await trx.table("field_data.raw_capture").insert(raw_capture_to_insert);

        // map_feature.raw_capture_feature
        const { lon, lat } = raw_capture_feature_to_insert;
        const values_to_insert = [
          ...Object.values(raw_capture_feature_to_insert),
        ];

        await trx.raw(
          `
          INSERT INTO map_features.raw_capture_feature 
          (
            id,
            attributes,
            capture_taken_at,
            created_at,
            device_identifier,
            field_user_id,
            field_username,
            lat,
            lon,
            updated_at,
            location
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,ST_PointFromText(?, 4326))`,
          [...values_to_insert, "POINT(" + lon + " " + lat + ")"]
        );
        trx.commit();
        bar.tick();
        if (bar.complete) {
          console.log("Migration Complete");
        }
      } catch (e) {
        console.log(`Error processing tree id ${tree_object.id} ${e}`);
        trx.rollback();
      }
      next();
    }
    const query_stream = knex.raw(`${base_query_string}`).stream()
    query_stream.pipe(ws);

  } catch (err) {
    console.log(err);
  }
}

migrate();
