const modelApi = 'https://api.matterport.com/api/models/graph';
const query = `query RoomDimensions($modelId: ID!, $units: Units) {
  model(id: $modelId) {
    id
    rooms {
      id
      label
      floor { id }
      dimensionEstimates(units: $units) {
        width
        depth
        height
        area
        areaIndoor
        lowerElevation
        units
      }
    }
    floors {
      id
      label
      sequence
      dimensionEstimates(units: $units) { area areaIndoor units }
    }
  }
}`;

async function main() {
  const [modelId, units = 'metric'] = process.argv.slice(2);
  if (!modelId || !['metric', 'imperial'].includes(units)) {
    throw new Error('Usage: npm run matterport:rooms -- MODEL_ID [metric|imperial]');
  }

  const { MATTERPORT_API_KEY: key, MATTERPORT_API_TOKEN: token } = process.env;
  if (!key || !token) {
    throw new Error('Set MATTERPORT_API_KEY and MATTERPORT_API_TOKEN in the environment or .env.costar.');
  }

  const authorization = 'Basic ' + Buffer.from(key + ':' + token).toString('base64');
  const response = await fetch(modelApi, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { modelId, units } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Matterport returned HTTP ${response.status}.`);

  const { data, errors } = await response.json();
  if (!data?.model) {
    throw new Error(errors?.map((error) => error.message).join('\n') || 'Matterport returned no model for this ID.');
  }
  for (const error of errors ?? []) console.error(error.message);
  console.log(JSON.stringify(data.model, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
