import { loadConfig } from '../config.js';

const cfg = await loadConfig();
if (cfg.demo) throw new Error('Set Photon environment variables to verify the connection');
const project = await fetch(`https://api.photon.codes/v1/projects/${encodeURIComponent(cfg.photonProject!)}/messages?pageSize=1`, {
  headers: { Authorization: `Bearer ${cfg.photonKey}` },
  signal: AbortSignal.timeout(12000),
});
await project.body?.cancel();
if (!project.ok) throw new Error(`Photon project check returned HTTP ${project.status}`);
console.log('Photon project accepted the configured credentials.');
if (cfg.photonTest) {
  console.log('Fictional property in use. Send START from each enrolled iMessage identity to verify delivery.');
} else {
  const roof = await fetch(cfg.property.roof.imageUrl!, { signal: AbortSignal.timeout(12000) });
  await roof.body?.cancel();
  if (!roof.ok || !roof.headers.get('content-type')?.startsWith('image/')) {
    throw new Error(`The Vexcel image URL did not return an image (HTTP ${roof.status}).`);
  }
  console.log('Vexcel image URL returned an image.');
  console.log('Matterport model configured. Open a live work order on the deployed hostname to verify Embed SDK access.');
}
