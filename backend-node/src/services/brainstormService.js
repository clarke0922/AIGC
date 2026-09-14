const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const imageClient = require('./imageClient');
const uploadService = require('./uploadService');
const aiConfigService = require('./aiConfigService');

const ASPECT_RATIOS = new Set(['21:9', '16:9', '9:16', '1:1', '4:3', '3:4']);

function normalizeAspectRatio(value) {
  return ASPECT_RATIOS.has(value) ? value : '21:9';
}

function normalizeResolution(value) {
  return String(value || '2k').toLowerCase() === '4k' ? '4k' : '2k';
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

function reduceRatio(width, height) {
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function getResolutionDimensions(aspectRatio, resolution) {
  const ratio = normalizeAspectRatio(aspectRatio);
  const tier = normalizeResolution(resolution);
  const longEdge = tier === '4k' ? 3840 : 2048;
  const [a, b] = ratio.split(':').map(Number);
  const landscape = a >= b;
  const width = landscape ? longEdge : Math.round(longEdge * a / b);
  const height = landscape ? Math.round(longEdge * b / a) : longEdge;
  return { width, height, ratio: reduceRatio(width, height) };
}

function getGenerationDimensions(target) {
  const scale = target.width >= target.height ? 1792 / target.width : 1792 / target.height;
  const width = Math.max(512, Math.round(target.width * scale / 2) * 2);
  const height = Math.max(512, Math.round(target.height * scale / 2) * 2);
  return { width, height };
}

function buildBrainstormPrompt(userPrompt, aspectRatio) {
  const idea = String(userPrompt || '').trim();
  const frame = normalizeAspectRatio(aspectRatio);
  return [
    `一张真实电影摄影质感的${idea || '具有决定性瞬间的电影场景'}，${frame}电影画幅构图。`,
    '摄影机位于人眼可理解的物理位置，使用28毫米全画幅广角镜头与自然透视，中远景构图，三分法布局，前景保留可触摸的实物层次，画面一侧保留克制负空间，静态剧照，不出现运镜。',
    '主体刚刚停在情绪发生前的一瞬，环境只保留推动情绪的关键道具、建筑表面、衣物材质、尘土、水汽与真实置景细节，人物占比克制，场面像实拍布景而不是物体清单。',
    '光线方向明确，使用现场可得的主光、边缘光与微弱环境反射，色彩服从单一情绪配方，胶片颗粒细微，皮肤、金属、石材和织物呈现真实材质，摄影参考以Roger Deakins式克制曝光与Hoyte van Hoytema式冷色写实为辅助。',
    '不要CG感、不要3D渲染、不要游戏截图、不要插画感、不要动漫、不要塑料材质，不要文字、不要字母、不要标识、不要Logo、不要水印，不要夸张英雄光、不要多余人物、不要镜头运动。',
  ].join(' ');
}

function getStorageRoot(config) {
  const configured = config.storage?.local_path;
  return configured && path.isAbsolute(configured)
    ? configured
    : path.join(process.cwd(), configured || path.join('data', 'storage'));
}

function ensureBrainstormFile(storageRoot, target) {
  const dir = path.join(storageRoot, 'brainstorms');
  fs.mkdirSync(dir, { recursive: true });
  const name = `brainstorm_${target.width}x${target.height}_${randomUUID()}.jpg`;
  const absolutePath = path.join(dir, name);
  return { absolutePath, localPath: `brainstorms/${name}` };
}

async function resizeSavedImage(storageRoot, localPath, target) {
  const sharp = require('sharp');
  const source = path.join(storageRoot, localPath);
  const buffer = fs.readFileSync(source);
  const output = ensureBrainstormFile(storageRoot, target);
  await sharp(buffer)
    .rotate()
    .resize(target.width, target.height, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(output.absolutePath);
  return output.localPath;
}

function listImageModelOptions(db) {
  const options = [];
  const configs = aiConfigService.listConfigs(db, 'image').filter((c) => c.is_active);
  for (const cfg of configs) {
    const models = Array.isArray(cfg.model) && cfg.model.length
      ? cfg.model
      : (cfg.default_model ? [cfg.default_model] : []);
    for (const model of models) {
      options.push({
        config_id: cfg.id,
        name: cfg.name || cfg.provider || '文生图模型',
        provider: cfg.provider || '',
        model: String(model),
        is_default: !!cfg.is_default && models[0] === model,
      });
    }
  }
  return options;
}

function resolveModelOptions(db, req) {
  const all = listImageModelOptions(db);
  if (!all.length) return [];
  const requested = Array.isArray(req.models)
    ? req.models.map((m) => String(m || '').trim()).filter(Boolean)
    : [];
  if (!requested.length) return [all[0]];
  const picked = [];
  for (const key of requested) {
    const match = all.find((item) => String(item.config_id) === key || `${item.config_id}:${item.model}` === key || item.model === key);
    if (match && !picked.some((p) => p.config_id === match.config_id && p.model === match.model)) {
      picked.push(match);
    }
  }
  return picked;
}

async function generateOne(db, log, config, fullPrompt, generation, target, storageRoot, modelOption, countPerModel) {
  const tasks = [];
  for (let i = 0; i < countPerModel; i += 1) {
    tasks.push((async () => {
      const result = await imageClient.callImageApi(db, log, {
        prompt: fullPrompt,
        model: modelOption?.model || undefined,
        size: `${generation.width}x${generation.height}`,
        quality: 'hd',
        imageServiceType: 'image',
        preferredProvider: modelOption?.provider || undefined,
        config_override: modelOption ? {
          ...(aiConfigService.getConfig(db, modelOption.config_id) || {}),
        } : undefined,
        user_negative_prompt: 'CGI, 3D render, game screenshot, illustration, anime, plastic texture, text, letters, logo, watermark, camera movement',
      });
      if (result.error) throw new Error(result.error);
      const localPath = await uploadService.downloadImageToLocal(
        storageRoot,
        result.image_url,
        'brainstorms',
        log,
        'brainstorm_'
      );
      if (!localPath) throw new Error('图片保存失败');
      const finalLocalPath = await resizeSavedImage(storageRoot, localPath, target);
      return {
        image_url: `/static/${finalLocalPath}`,
        local_path: finalLocalPath,
        download_url: `/static/${finalLocalPath}`,
        model: modelOption?.model || 'default',
        model_name: modelOption?.name || '默认文生图模型',
        width: target.width,
        height: target.height,
      };
    })());
  }
  return Promise.all(tasks);
}

async function generateBrainstormImages(db, log, config, req) {
  const prompt = String(req.prompt || '').trim();
  if (!prompt) throw new Error('请输入头脑风暴提示词');
  if (prompt.length > 4000) throw new Error('提示词不能超过4000字');

  const aspectRatio = normalizeAspectRatio(req.aspect_ratio);
  const resolution = normalizeResolution(req.resolution);
  const target = getResolutionDimensions(aspectRatio, resolution);
  const generation = getGenerationDimensions(target);
  const fullPrompt = buildBrainstormPrompt(prompt, aspectRatio);
  const storageRoot = getStorageRoot(config);
  const modelOptions = resolveModelOptions(db, req);
  if (!modelOptions.length) throw new Error('未配置可用的文生图（image）模型，请在「AI 配置」中添加并启用');
  const explicitModels = Array.isArray(req.models) && req.models.filter(Boolean).length > 0;
  const countPerModel = explicitModels && modelOptions.length > 1 ? 1 : 2;
  const groups = await Promise.all(modelOptions.map((option) =>
    generateOne(db, log, config, fullPrompt, generation, target, storageRoot, option, countPerModel)
  ));
  const images = groups.flat().map((item, index) => ({
    ...item,
    id: `${index + 1}`,
    prompt: fullPrompt,
    aspect_ratio: aspectRatio,
    resolution,
  }));
  return {
    images,
    model_options: listImageModelOptions(db),
    prompt: fullPrompt,
    aspect_ratio: aspectRatio,
    resolution,
    width: target.width,
    height: target.height,
  };
}

module.exports = {
  buildBrainstormPrompt,
  getResolutionDimensions,
  generateBrainstormImages,
  listImageModelOptions,
};
