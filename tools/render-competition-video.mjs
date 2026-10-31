import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Production tool: neural speech (or explicit macOS fallback), ffmpeg, and a canvas package.
const [evidencePath, demoPath, outputPath, ...extra] = process.argv.slice(2);
if (!outputPath || extra.length) throw new Error(
  'Usage: render-competition-video.mjs published-evidence demo-video-directory output-directory');
const { createCanvas, loadImage, GlobalFonts } = createRequire(import.meta.url)(
  process.env.TAPEEXIT_CANVAS_MODULE ?? '@napi-rs/canvas');
if (!GlobalFonts.registerFromPath(process.env.TAPEEXIT_VIDEO_FONT ??
    '/System/Library/Fonts/STHeiti Medium.ttc', 'TapeExitCJK'))
  throw new Error('A Chinese font must be available for legible captions');
const output = resolve(outputPath), evidence = resolve(evidencePath), demo = resolve(demoPath);
const speechEngine = process.env.TAPEEXIT_VIDEO_ENGINE ?? 'edge';
if (!['edge', 'system'].includes(speechEngine)) throw new Error('Unsupported speech engine');
const voice = process.env.TAPEEXIT_VIDEO_VOICE ??
  (speechEngine === 'edge' ? 'zh-CN-YunxiNeural' : 'Tingting');
const speechRate = process.env.TAPEEXIT_VIDEO_RATE ?? (speechEngine === 'edge' ? '+0%' : '225');
await mkdir(output, { recursive: true });
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const acceptance = await json(`${evidence}/public-acceptance.json`);
const recording = await json(`${demo}/recording.json`);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (acceptance.status !== 'PUBLISHED_VAULT_RECOVERY_CHECKED' ||
    recording.environment !== 'ISOLATION_DEMO' ||
    sha(await readFile(`${demo}/TapeExit-Isolation-Demo.webm`)) !== recording.videoSha256)
  throw new Error('Verified publication evidence and labelled demo recording required');
const scenes = [
  {
    title: '原站失效，资产如何找回？', tag: '产品与使用场景', image: 'netlify-desktop.png',
    facts: ['TapeOut × X Layer', '两个实际协议模块', '同一链上应用，多个入口'],
    text: '如果常用的 DeFi 网站突然打不开，链上的资产怎么办？这就是 TapeExit 想解决的问题。我们把应用文件放进 TapeOut 的链上容器。用户可以换个网关，或者打开提前下载的本地包，继续查看仓位、预演退出，再核对结果。',
  },
  {
    title: 'Uniswap V3：读取、预演与核对', tag: '隔离模拟 · 测试资产 · 不发送交易', video: true,
    facts: ['读取自持 NFT 仓位', '选择部分或全部退出', '核对目标、收款人与金额'],
    text: '先看这段 V3 演示。画面是模拟环境，不会发送真实交易。打开仓位，选择退出一半，然后检查目标合约、收款人和金额。仓位 NFT 不需要交给我们托管。如果数据来源互相矛盾，流程就会停下来，等核对清楚再继续。',
  },
  {
    title: 'Spark USDC：第二类协议已实测', tag: '真实主网结果 · 只读重新核验', image: 'vercel-desktop.png',
    facts: ['存入：1.000000 USDC', '两次赎回：1.000002 USDC', '剩余份额：0', '四笔交易：已最终确认'],
    text: '再看真实主网测试。我们在 Spark 金库存入一枚 USDC，先赎回一半，再赎回剩余份额。四笔交易都已最终确认。两次实际到账，合计一点零零零零零二 USDC，剩余份额为零。这里展示的是已发布应用重新核对链上结果，不是钱包签名录像。',
  },
  {
    title: 'TapeOut 承载真实应用文件', tag: '链上发行证据 · 0.3.0-f8771a8', image: 'netlify-desktop.png',
    facts: ['2.2.289.tape', '16 文件 / 647,523 字节', '链上逐字节回读通过', '34 笔上传完成，剩余 0'],
    text: 'TapeOut 在这里，实际保存了整个应用。新版十六个文件已经逐字节回读，三十四笔上传全部完成，不用再签名。两个公网入口，都读取同一个链上容器。TapeOut 保存应用入口，TapeExit 适配退出流程。资产仍由原钱包和原协议管理。',
  },
  {
    title: '主入口断开，备用入口继续恢复', tag: '真实公网演练 · HTTPS 主网关阻断', image: 'vercel-mobile.png',
    facts: ['Netlify 主入口连接被阻断', 'Vercel 桌面与手机恢复成功', '导入文件 → 刷新 → 重新核验', '4 个视图 / 64 次文件检查'],
    text: '如果主入口也断了呢？我们主动阻断了主网关的连接，再从备用入口导入恢复文件。刷新页面之后，系统必须重新核对到账、份额和最终确认。桌面和手机，四个全新会话，完成了六十四次文件检查。恢复时不用连接钱包，也不会重复赎回。',
  },
  {
    title: '从应急工具，走向协议恢复服务', tag: '公开版本只读 · 独立安全审阅尚未完成', image: 'vercel-desktop.png',
    facts: ['基础工具开源免费', '适配、故障演练与维护服务', '后续：V2 LP、质押、借贷', '生产签名保持关闭'],
    text: '我们希望，让 DeFi 用户和协议团队提前备好退出路径。基础工具开源免费，后续探索协议适配、故障演练和维护服务，目前还没有客户或收入。V3 和金库，已经验证了两类协议的扩展方式。其他平台会逐个接入。独立安全审阅还没完成，生产签名继续关闭。',
  },
];
const font = '"TapeExitCJK", "Arial", sans-serif';
function wrap(ctx, text, x, y, width, lineHeight) {
  let line = '';
  for (const character of text) {
    if (ctx.measureText(line + character).width > width && line) {
      ctx.fillText(line, x, y); y += lineHeight; line = character;
    } else line += character;
  }
  if (line) ctx.fillText(line, x, y);
  return y;
}
function fit(ctx, image, x, y, w, h) {
  const scale = Math.min(w / image.width, h / image.height);
  ctx.drawImage(image, x + (w - image.width * scale) / 2, y + (h - image.height * scale) / 2,
    image.width * scale, image.height * scale);
}
let elapsed = 0;
const clips = [], subtitles = [];
const srtTime = seconds => {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
for (const [index, scene] of scenes.entries()) {
  const base = `${output}/scene-${index + 1}`;
  await writeFile(`${base}.txt`, scene.text + '\n');
  const audio = `${base}.${speechEngine === 'edge' ? 'mp3' : 'aiff'}`;
  if (speechEngine === 'edge')
    execFileSync(process.env.TAPEEXIT_EDGE_TTS ?? 'edge-tts',
      ['--voice', voice, `--rate=${speechRate}`, '--file', `${base}.txt`, '--write-media', audio],
      { stdio: 'pipe', timeout: 90000 });
  else
    execFileSync('say', ['-v', voice, '-r', speechRate,
      '-f', `${base}.txt`, '-o', audio], { stdio: 'pipe', timeout: 90000 });
  const audioSeconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', audio], { encoding: 'utf8' }).trim());
  if (!Number.isFinite(audioSeconds) || audioSeconds <= 0) throw new Error('Narration generation failed');
  scene.duration = Math.ceil(audioSeconds + 1);
  scene.start = elapsed; elapsed += scene.duration;
  if (elapsed > 179) throw new Error('Pitch exceeds three-minute rule; shorten the narration');
  const canvas = createCanvas(1920, 1080), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1920, 1080);
  if (scene.video) ctx.clearRect(40, 155, 1280, 720);
  else fit(ctx, await loadImage(`${evidence}/${scene.image}`), 40, 155, 1280, 720);
  ctx.font = `bold 34px ${font}`; ctx.fillStyle = '#29634d'; ctx.fillText('TapeExit', 45, 53);
  ctx.font = `bold 36px ${font}`; ctx.fillStyle = '#162b22'; ctx.fillText(scene.title, 245, 53);
  ctx.font = `25px ${font}`; ctx.fillStyle = '#495d53';
  ctx.fillText(scene.tag + (scene.video ? ` · 录像源码 ${recording.sourceCommit.slice(0, 7)}` : ''), 45, 112);
  ctx.fillStyle = '#29634d'; ctx.fillRect(1364, 178, 4, 670);
  ctx.font = `bold 29px ${font}`; ctx.fillStyle = '#162b22';
  let y = 225;
  for (const fact of scene.facts) { y = wrap(ctx, fact, 1400, y, 465, 43) + 55; }
  ctx.fillStyle = '#12231c'; ctx.fillRect(0, 900, 1920, 180);
  ctx.font = `28px ${font}`; ctx.fillStyle = '#ffffff';
  wrap(ctx, scene.text, 48, 947, 1824, 42);
  ctx.font = `20px ${font}`; ctx.fillStyle = '#60756a';
  ctx.fillText(`${index + 1} / ${scenes.length}   ·   X Layer 196   ·   ${acceptance.sourceCommit.slice(0, 7)}`, 1400, 866);
  await writeFile(`${base}.png`, canvas.toBuffer('image/png'));
  const inputs = scene.video ? ['-stream_loop', '-1', '-i', `${demo}/TapeExit-Isolation-Demo.webm`,
    '-loop', '1', '-i', `${base}.png`, '-i', audio] :
    ['-loop', '1', '-i', `${base}.png`, '-i', audio];
  const filters = scene.video ?
    '[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:white,pad=1920:1080:40:155:white[base];[base][1:v]overlay=0:0,format=yuv420p[v]' :
    '[0:v]format=yuv420p[v]';
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs,
    '-filter_complex', filters, '-map', '[v]', '-map', `${scene.video ? 2 : 1}:a`,
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=9,apad', '-t', String(scene.duration), '-r', '24', '-c:v', 'libx264',
    '-preset', 'fast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', `${base}.mp4`],
    { stdio: 'pipe', timeout: 120000 });
  clips.push(`file '${base.replaceAll("'", "'\\''")}.mp4'`);
  subtitles.push(`${index + 1}\n${srtTime(scene.start)} --> ${srtTime(elapsed)}\n${scene.text}\n`);
  console.log(`Rendered ${index + 1}/${scenes.length}: ${scene.duration}s`);
}
await writeFile(`${output}/clips.txt`, clips.join('\n') + '\n');
await writeFile(`${output}/TapeExit-Pitch.zh.srt`, subtitles.join('\n'));
const video = `${output}/TapeExit-Competition-Pitch.mp4`;
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0',
  '-i', `${output}/clips.txt`, '-c', 'copy', '-movflags', '+faststart', video], { timeout: 120000 });
const details = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams',
  '-of', 'json', video], { encoding: 'utf8' }));
if (Number(details.format.duration) > 180 || !details.streams.some(s => s.codec_type === 'audio') ||
    !details.streams.some(s => s.codec_type === 'video' && s.width === 1920 && s.height === 1080))
  throw new Error('Final video format/duration invalid');
await writeFile(`${output}/video.json`, JSON.stringify({
  schemaVersion: 1, createdAt: new Date().toISOString(), status: 'COMPETITION_PITCH_RENDERED',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  publishedSourceCommit: acceptance.sourceCommit, demoRecordingSourceCommit: recording.sourceCommit,
  evidenceManifestSha256: acceptance.manifestSha256, sha256: sha(await readFile(video)),
  durationSeconds: Number(details.format.duration), width: 1920, height: 1080,
  narration: { language: 'zh-CN', engine: speechEngine, voice, rate: speechRate,
    gender: voice === 'zh-CN-YunxiNeural' ? 'male' : 'unspecified', liveHumanVoice: false },
  scenes, productionSigningApproved: false, independentReview: 'NOT_COMPLETED',
  scope: 'Narrated evidence presentation, labelled simulation clip and actual read-only public gateway screenshots. ' +
    'Not a recording of wallet signing, a new transaction, independent review or competition submission.',
}, null, 2) + '\n');
console.log(`Pitch rendered: ${Number(details.format.duration).toFixed(1)}s / 180s, ${video}`);
