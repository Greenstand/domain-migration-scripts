const createCapture = async (rawCapture, tree, trx, treeTags) => {
  const existingCapture = await trx
    .select()
    .table('treetracker.capture')
    .where('reference_id', rawCapture.reference_id)
    .orWhere('id', rawCapture.id)
    .first();

  if (existingCapture) {
    return existingCapture;
  }

  let plantingOrganizationId = null;

  if (tree.planting_organization_id) {
    const org = await trx
      .select()
      .table('public.entity')
      .where({ id: tree.planting_organization_id })
      .first();

    plantingOrganizationId = org.stakeholder_uuid;
  }

  let speciesId = null;
  if (tree.species_id) {
    const species = await trx
      .select()
      .table('public.tree_species')
      .where({ id: tree.species_id })
      .first();
    
    if(!species){
      throw new Error(`can not find species of tree: ${tree.id}`);
    }

    speciesId = species.uuid;
  }

  const {lat} = rawCapture;
  const {lon} = rawCapture;

  const captureToCreate = {
    id: rawCapture.id,
    reference_id: rawCapture.reference_id,
    image_url: rawCapture.image_url,
    lat,
    lon,
    estimated_geometric_location: trx.raw(
      `ST_PointFromText('POINT(${lon} ${lat})', 4326)`,
    ),
    gps_accuracy: rawCapture.gps_accuracy && Math.round(parseFloat(rawCapture.gps_accuracy)),
    morphology: tree.morphology,
    age: tree.age === 'over_two_years' ? 2 : 0,
    note: rawCapture.note,
    attributes: rawCapture.extra_attributes,
    domain_specific_data: tree.domain_specific_data,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    estimated_geographic_location: trx.raw(
      `ST_PointFromText('POINT(${lon} ${lat})', 4326)`,
    ),
    device_configuration_id: rawCapture.device_configuration_id,
    session_id: rawCapture.session_id,
    grower_account_id: rawCapture.grower_account_id,
    planting_organization_id: plantingOrganizationId,
    species_id: speciesId,
    captured_at: rawCapture.captured_at,
  };

  await trx.insert(captureToCreate).into('treetracker.capture');

  for (const { uuid } of treeTags) {
    await trx
      .insert({ capture_id: captureToCreate.id, tag_id: uuid })
      .into('treetracker.capture_tag');
  }

  // raw captures created before verify tool was moved to the microservices
  if (rawCapture.status !== 'approved') {
    await trx('field_data.raw_capture')
      .update({ status: 'approved' })
      .where({ id: rawCapture.id });
  }
};

module.exports = createCapture;
