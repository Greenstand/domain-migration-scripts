const createRawCapture = async (tree, treeAttributes, sessionId, trx) => {
  const extra_attributes = { entries: [] };

  let abs_step_count = null;
  let delta_step_count = null;
  let rotation_matrix = null;

  for (const { key, value } of treeAttributes) {
    if (key === 'abs_step_count') {
      abs_step_count = value;
    }

    if (key === 'delta_step_count') {
      delta_step_count = value;
    }

    if (key === 'rotation_matrix') {
      const matrixArray = value.split(',');
      rotation_matrix = matrixArray.map((m) => +m);
    }

    extra_attributes.entries.push({
      [key]: value,
    });
  }

  const { active, approved } = tree;
  let status = 'unprocessed';

  if (!active) {
    // active is false
    status = 'rejected';
  } else if (active && approved) {
    status = 'approved';
  }

  const rawCapture = {
    id: tree.uuid,
    reference_id: tree.id,
    image_url: tree.image_url,
    lat: tree.lat,
    lon: tree.lon,
    gps_accuracy: tree.gps_accuracy,
    note: tree.note,
    extra_attributes: extra_attributes.entries.length ? extra_attributes : null,
    status,
    rejection_reason: tree.rejection_reason,
    captured_at: tree.time_created,
    session_id: sessionId,
    abs_step_count,
    delta_step_count,
    rotation_matrix,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const existingRawCapture = await trx
    .select()
    .table('field_data.raw_capture')
    .where('id', tree.uuid)
    .first();

  if (existingRawCapture) {
    console.log('Raw capture already exists', tree.uuid);
    return existingRawCapture;
  }

  await trx.insert(rawCapture).into('field_data.raw_capture');
};

module.exports = createRawCapture;
