const { v4: uuid } = require('uuid');

const createTree = async (capture, trx, captureTags) => {
  const existingCapture = await trx
    .select()
    .table('treetracker.tree')
    .where('latest_capture_id', capture.id)
    .first();

  if (existingCapture) {
    return existingCapture;
  }

  const {lat} = capture;
  const {lon} = capture;

  const treeToCreate = {
    id: uuid(),
    latest_capture_id: capture.id,
    image_url: capture.image_url,
    lat,
    lon,
    estimated_geometric_location: trx.raw(
      `ST_PointFromText('POINT(${lon} ${lat})', 4326)`,
    ),
    gps_accuracy: capture.gps_accuracy,
    morphology: capture.morphology,
    age: capture.age,
    estimated_geographic_location: trx.raw(
      `ST_PointFromText('POINT(${lon} ${lat})', 4326)`,
    ),
    attributes: capture.attributes,
    species_id: capture.species_id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };


  

  await trx.insert(treeToCreate).into('treetracker.tree');

  for (const { tag_id } of captureTags) {
    await trx
      .insert({ tree_id: treeToCreate.id, tag_id })
      .into('treetracker.tree_tag');
  }

  await trx('treetracker.capture')
    .update({ tree_id: treeToCreate.id })
    .where({ id: capture.id });
};

module.exports = createTree;
