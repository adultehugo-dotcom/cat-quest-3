import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { GameState, Vec2, ZoneId } from '../game/types';
import { DUNGEONS } from '../data/dungeonsData';
import { DUNGEON_PALETTE } from '../art/palette';
import {
  createTiltShiftVignettePass,
  updateTiltShiftResolution,
} from './shaders/tiltShiftShader';
import type { WeatherSnapshot } from './weatherSystem';
import { clearSpriteLight, setSpriteLight } from './spriteLighting';

const BASE_CAM_OFFSET_Y = 19;
const BASE_CAM_OFFSET_Z = 17.5;
const LOOK_OFFSET_Y = 0.5;
const LOOK_OFFSET_Z = -0.8;

const BASE_CAMERA_FOV = 38;
const FOV_COMPENSATION_ASPECT = 1.2;
const MAX_CAMERA_FOV = 62;
const SOFTWARE_RENDERER_PIXEL_RATIO = 0.5;
const MAX_HARDWARE_PIXEL_RATIO = 2;

export function computeResponsiveFov(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0 || aspect >= FOV_COMPENSATION_ASPECT) {
    return BASE_CAMERA_FOV;
  }
  const halfBaseRad = THREE.MathUtils.degToRad(BASE_CAMERA_FOV * 0.5);
  const compensatedRad =
    2 * Math.atan((Math.tan(halfBaseRad) * FOV_COMPENSATION_ASPECT) / aspect);
  return Math.min(MAX_CAMERA_FOV, THREE.MathUtils.radToDeg(compensatedRad));
}

export function isSoftwareRendererName(rendererName: string): boolean {
  return /swiftshader|llvmpipe|software rasterizer|basic render driver|\bwarp\b/i.test(
    rendererName,
  );
}

const SHADOW_MAP_SIZE = 2048;
const SHADOW_EXTENT_GAMEPLAY = 28;
const SHADOW_EXTENT_TITLE = 52;
const MAX_ACTIVE_TORCH_LIGHTS = 8;

export interface ProjectedPoint {
  x: number;
  y: number;
  visible: boolean;
}

export interface TorchLightPosition {
  x: number;
  y: number;
  z: number;
  intensity?: number;
  distance?: number;
  outdoor?: boolean;
}

export interface PostProcessingConfig {
  bloomThreshold?: number;
  bloomStrength?: number;
  bloomRadius?: number;
  ssaoEnabled?: boolean;
  ssaoStrength?: number;
  tiltShiftEnabled?: boolean;
  maxBlur?: number;
  vignetteStrength?: number;
}

interface DynamicTorchSlot {
  light: THREE.PointLight;
  assignedIndex: number;
}

interface TorchSpec {
  x: number;
  y: number;
  z: number;
  seed: number;
  intensity: number;
  distance: number;
  outdoor: boolean;
}

/**
 * SSAOPass calibré spécialement pour un diorama 2.5D :
 * - Exclut les sprites transparents / découpés (alphaTest / depthWrite:false) et les VFX
 *   du pass normal/profondeur afin d'éliminer tout halo rectangulaire noir autour des personnages/arbres.
 * - Remappe l'occlusion de contact avec une force subtile et une teinte fraîche diorama pour
 *   sculpter le relief des murs/pierres sans jamais assombrir la scène.
 */
class DioramaSSAOPass extends SSAOPass {
  private readonly dioramaVisCache = new Map<THREE.Object3D, boolean>();

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
    kernelSize = 16,
  ) {
    super(scene, camera, width, height, kernelSize);

    this.kernelRadius = 2.6;
    this.minDistance = 0.0018;
    this.maxDistance = 0.045;

    // Remplace le shader de composition pour contrôler finement la force & le plancher d'AO
    this.copyMaterial.uniforms.uAoStrength = { value: 0.48 };
    this.copyMaterial.uniforms.uAoFloor = { value: 0.46 };
    this.copyMaterial.fragmentShader = /* glsl */ `
      precision highp float;
      uniform sampler2D tDiffuse;
      uniform float opacity;
      uniform float uAoStrength;
      uniform float uAoFloor;
      varying vec2 vUv;
      void main() {
        float ao = texture2D(tDiffuse, vUv).r;
        float remapped = mix(uAoFloor, 1.0, ao);
        float factor = mix(1.0, remapped, uAoStrength);
        // Légère teinte fraîche dans les creux diorama (évite les ombres grises ternes)
        vec3 tint = mix(vec3(0.89, 0.91, 0.98), vec3(1.0), factor);
        gl_FragColor = vec4(tint * factor, opacity);
      }
    `;
    this.copyMaterial.needsUpdate = true;
  }

  public setAoStrength(strength: number): void {
    if (this.copyMaterial.uniforms.uAoStrength) {
      this.copyMaterial.uniforms.uAoStrength.value = THREE.MathUtils.clamp(strength, 0, 1);
    }
  }

  private shouldExclude(obj: THREE.Object3D): boolean {
    if (obj.userData && obj.userData.skipSSAO === true) return true;
    if (
      (obj as THREE.Points).isPoints ||
      (obj as THREE.Line).isLine ||
      (obj as THREE.Sprite).isSprite
    ) {
      return true;
    }

    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (mat.transparent || mat.alphaTest > 0 || mat.depthWrite === false) {
          return true;
        }
      }
    }
    return false;
  }

  // Appelé dynamiquement par SSAOPass.render()
  public overrideVisibility(): void {
    this.dioramaVisCache.clear();
    this.scene.traverse((object) => {
      this.dioramaVisCache.set(object, object.visible);
      if (this.shouldExclude(object)) {
        object.visible = false;
      }
    });
  }

  // Appelé dynamiquement par SSAOPass.render()
  public restoreVisibility(): void {
    for (const [object, wasVisible] of this.dioramaVisCache.entries()) {
      object.visible = wasVisible;
    }
    this.dioramaVisCache.clear();
  }
}

export class SceneManager {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly domElement: HTMLCanvasElement;

  private readonly container: HTMLElement;
  private readonly ambientLight: THREE.AmbientLight;
  private readonly dirLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly dirLightOffset = new THREE.Vector3(26, 42, 22);
  private readonly sunDirection = new THREE.Vector3(26, 42, 22).normalize();
  private readonly overworldBgColor = new THREE.Color(0x1b5e85);
  private readonly overworldFog = new THREE.Fog(0x216b94, 115, 265);
  private currentShadowExtent = SHADOW_EXTENT_GAMEPLAY;

  // Pipeline Post-Processing (EffectComposer)
  private composer: EffectComposer | null = null;
  private composerTarget: THREE.WebGLRenderTarget | null = null;
  private renderPass: RenderPass | null = null;
  private ssaoPass: DioramaSSAOPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private tiltShiftPass: ShaderPass | null = null;
  private outputPass: OutputPass | null = null;
  private postProcessingActive = false;

  // Pool de PointLights dynamiques scintillantes pour les torches de donjons
  private readonly torchGroup = new THREE.Group();
  private readonly torchPool: DynamicTorchSlot[] = [];
  private torchSpecs: TorchSpec[] = [];
  private readonly nearestTorchIndices = new Int32Array(MAX_ACTIVE_TORCH_LIGHTS);
  private readonly nearestTorchDistanceSq = new Float32Array(MAX_ACTIVE_TORCH_LIGHTS);
  private torchWarmColor = new THREE.Color(0xff9f40);
  private torchHotColor = new THREE.Color(0xffc96b);
  private torchEmberColor = new THREE.Color(0xff6b24);
  private readonly torchColorScratch = new THREE.Color();
  private torchBaseIntensity = 8.5;
  private outdoorLampBrightness = 0;

  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly pointerNdc = new THREE.Vector2();
  private readonly rayHit = new THREE.Vector3();
  private readonly projVec = new THREE.Vector3();
  private readonly tempVec = new THREE.Vector3();

  private readonly camPos = new THREE.Vector3(0, BASE_CAM_OFFSET_Y, 24 + BASE_CAM_OFFSET_Z);
  private readonly camLookAt = new THREE.Vector3(0, LOOK_OFFSET_Y, 24 + LOOK_OFFSET_Z);
  private currentZoom = 1.0;
  private maritimeLeadX = 0;
  private maritimeLeadZ = 0;
  private titleOrbitAngle = 0.35;
  private internalShake = 0;
  private shakeClock = 0;
  private effectTime = 0;
  private lastCameraDt = 0.016;
  private updatedSinceLastRender = false;
  private activeLightingZone: ZoneId | null = null;
  private readonly isSoftwareRenderer: boolean;
  private cameraInitialized = false;
  private lastScreen: GameState['screen'] | null = null;

  private readonly boundResize: () => void;

  constructor(container: HTMLElement) {
    this.container = container;

    const width = Math.max(1, container.clientWidth || window.innerWidth);
    const height = Math.max(1, container.clientHeight || window.innerHeight);

    this.scene = new THREE.Scene();

    const aspect = width / height;
    this.camera = new THREE.PerspectiveCamera(
      computeResponsiveFov(aspect),
      aspect,
      0.5,
      300,
    );
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLookAt);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    const gl = this.renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info') as
      | { UNMASKED_RENDERER_WEBGL: number }
      | null;
    const rendererName = debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
      : '';
    this.isSoftwareRenderer = isSoftwareRendererName(rendererName);

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = !this.isSoftwareRenderer;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const pixelRatio = this.getPixelRatio();
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);

    this.domElement = this.renderer.domElement;
    this.domElement.style.width = '100%';
    this.domElement.style.height = '100%';
    this.domElement.style.display = 'block';
    container.appendChild(this.domElement);

    // Éclairage Diorama calibré pour ombres douces réalistes + ACES Filmic + Bloom sélectif
    this.ambientLight = new THREE.AmbientLight(0xfff4e0, 0.28);
    this.hemiLight = new THREE.HemisphereLight(0xb4e2ff, 0x637a3f, 0.32);

    this.dirLight = new THREE.DirectionalLight(0xffe5ba, 1.55);
    this.dirLight.position.copy(this.dirLightOffset);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.dirLight.shadow.camera.near = 2;
    this.dirLight.shadow.camera.far = 140;
    this.dirLight.shadow.camera.left = -SHADOW_EXTENT_GAMEPLAY;
    this.dirLight.shadow.camera.right = SHADOW_EXTENT_GAMEPLAY;
    this.dirLight.shadow.camera.top = SHADOW_EXTENT_GAMEPLAY;
    this.dirLight.shadow.camera.bottom = -SHADOW_EXTENT_GAMEPLAY;
    this.dirLight.shadow.bias = -0.0004;
    this.dirLight.shadow.normalBias = 0.035;
    this.dirLight.shadow.radius = 2.4;
    this.dirLight.shadow.camera.updateProjectionMatrix();

    this.scene.add(this.ambientLight);
    this.scene.add(this.hemiLight);
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    // Groupe dédié aux torches dynamiques des donjons
    this.torchGroup.name = 'DynamicTorchLights';
    this.scene.add(this.torchGroup);

    this.setZoneLighting('overworld');
    if (!this.isSoftwareRenderer) {
      this.initPostProcessing(width, height, pixelRatio);
    }

    this.boundResize = () => this.resize();
    window.addEventListener('resize', this.boundResize);
  }

  private initPostProcessing(width: number, height: number, pixelRatio: number): void {
    try {
      const gl = this.renderer.getContext();
      const isWebGL2 = this.renderer.capabilities.isWebGL2;
      const hasFloatColorBuffer =
        isWebGL2 && Boolean(gl.getExtension('EXT_color_buffer_float'));
      const hasHalfFloatColorBuffer =
        hasFloatColorBuffer || Boolean(gl.getExtension('EXT_color_buffer_half_float'));

      // Sans render-target HalfFloat (contexte WebGL1 très limité), fallback gracieux sur rendu direct
      if (!hasHalfFloatColorBuffer) {
        this.postProcessingActive = false;
        return;
      }

      const effW = Math.max(1, Math.floor(width * pixelRatio));
      const effH = Math.max(1, Math.floor(height * pixelRatio));
      const samples = hasFloatColorBuffer
        ? Math.min(4, this.renderer.capabilities.maxSamples || 0)
        : 0;

      const rt = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.HalfFloatType,
        samples,
      });
      rt.texture.name = 'DioramaComposer.rt1';
      this.composerTarget = rt;

      const composer = new EffectComposer(this.renderer, rt);
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);

      // 1. RenderPass principal (HDR linéaire + ombres PCFSoft 2048×2048)
      const renderPass = new RenderPass(this.scene, this.camera);
      composer.addPass(renderPass);
      this.renderPass = renderPass;

      // 2. SSAOPass calibré diorama (WebGL2 uniquement, fallback gracieux si extension absente)
      if (isWebGL2) {
        try {
          const ssaoPass = new DioramaSSAOPass(this.scene, this.camera, effW, effH, 16);
          ssaoPass.output = SSAOPass.OUTPUT.Default;
          composer.addPass(ssaoPass);
          this.ssaoPass = ssaoPass;
        } catch {
          this.ssaoPass = null;
        }
      }

      // 3. UnrealBloomPass sélectif (seules les sources magiques/HDR > 0.85 brillent !)
      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(effW, effH),
        0.48,
        0.42,
        0.85,
      );
      composer.addPass(bloomPass);
      this.bloomPass = bloomPass;

      // 4. Tilt-Shift (effet maquette miniature) + Vignette cinématographique douce
      const tiltShiftPass = createTiltShiftVignettePass({
        focusY: 0.48,
        focusWidth: 0.24,
        falloff: 0.28,
        maxBlur: 3.4,
        vignetteStrength: 0.24,
        vignetteRadius: 0.76,
        saturation: 1.04,
      });
      updateTiltShiftResolution(tiltShiftPass, effW, effH);
      composer.addPass(tiltShiftPass);
      this.tiltShiftPass = tiltShiftPass;

      // 5. OutputPass : ACESFilmicToneMapping (exposure 1.05) + transfert sRGB final
      const outputPass = new OutputPass();
      composer.addPass(outputPass);
      this.outputPass = outputPass;

      this.composer = composer;
      this.postProcessingActive = true;
    } catch {
      this.disposePostProcessing();
      this.postProcessingActive = false;
    }
  }

  private disposePostProcessing(): void {
    if (this.ssaoPass) {
      const disposableSsao = this.ssaoPass as unknown as { dispose?: () => void };
      disposableSsao.dispose?.();
      this.ssaoPass = null;
    }
    this.bloomPass?.dispose();
    this.bloomPass = null;
    this.tiltShiftPass?.dispose();
    this.tiltShiftPass = null;
    this.outputPass?.dispose();
    this.outputPass = null;
    this.renderPass?.dispose();
    this.renderPass = null;
    this.composer?.dispose();
    this.composer = null;
    this.composerTarget?.dispose();
    this.composerTarget = null;
    this.postProcessingActive = false;
  }

  public getMaxAnisotropy(): number {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  public getSunDirection(): THREE.Vector3 {
    return this.sunDirection.clone();
  }

  public getCameraFocusPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.camLookAt);
  }

  public getCameraFocusDistance(): number {
    return Math.max(18, this.camPos.distanceTo(this.camLookAt));
  }

  public getFogNear(): number {
    return this.scene.fog instanceof THREE.Fog ? this.scene.fog.near : 115;
  }

  public getFogFar(): number {
    return this.scene.fog instanceof THREE.Fog ? this.scene.fog.far : 265;
  }

  /**
   * Applique en temps réel l'éclairage, la couleur de ciel, la direction solaire/lunaire
   * et le brouillard du système météo / cycle jour-nuit sur tout l'overworld (0 allocation/frame).
   * Ne modifie jamais les donjons souterrains.
   */
  public applyOverworldAtmosphere(weather: WeatherSnapshot, isOverworld: boolean): void {
    if (!isOverworld) return;

    if (this.scene.background !== this.overworldBgColor) {
      this.scene.background = this.overworldBgColor;
    }
    if (this.scene.fog !== this.overworldFog) {
      this.scene.fog = this.overworldFog;
    }

    const focusDist = this.getCameraFocusDistance();
    this.overworldBgColor.copy(weather.fogColor);
    this.overworldFog.color.copy(weather.fogColor);
    this.overworldFog.near = focusDist + weather.fogNearOffset;
    this.overworldFog.far = Math.max(
      this.overworldFog.near + 20,
      focusDist + weather.fogFarOffset,
    );

    this.ambientLight.color.copy(weather.ambientColor);
    this.ambientLight.intensity = weather.ambientIntensity;

    this.hemiLight.color.copy(weather.hemiSkyColor);
    this.hemiLight.groundColor.copy(weather.hemiGroundColor);
    this.hemiLight.intensity = weather.hemiIntensity;

    this.dirLight.color.copy(weather.dirLightColor);
    this.dirLight.intensity = weather.dirLightIntensity;
    this.dirLightOffset.copy(weather.dirLightOffset);
    this.sunDirection.copy(weather.sunDirection);
    this.outdoorLampBrightness = THREE.MathUtils.clamp(
      Math.max(
        weather.nightFactor * 0.96,
        weather.sunsetFactor * 0.52,
        weather.dawnFactor * 0.36,
        weather.fogIntensity * 0.52,
        weather.stormIntensity * 0.65,
      ),
      0,
      1,
    );

    // Maintient les ombres alignées sur la nouvelle position solaire/lunaire
    this.updateShadowFollow(this.camLookAt.x, this.camLookAt.z, this.currentShadowExtent);
  }

  public isPostProcessingEnabled(): boolean {
    return this.postProcessingActive && this.composer !== null;
  }

  public isSsaoEnabled(): boolean {
    return Boolean(this.ssaoPass && this.ssaoPass.enabled);
  }

  private getPixelRatio(): number {
    return Math.min(
      window.devicePixelRatio || 1,
      this.isSoftwareRenderer ? SOFTWARE_RENDERER_PIXEL_RATIO : MAX_HARDWARE_PIXEL_RATIO,
    );
  }

  /**
   * Permet d'ajuster dynamiquement le post-processing (QA / calibration live).
   */
  public setPostProcessingOptions(config: PostProcessingConfig): void {
    if (this.bloomPass) {
      if (config.bloomThreshold !== undefined) this.bloomPass.threshold = config.bloomThreshold;
      if (config.bloomStrength !== undefined) this.bloomPass.strength = config.bloomStrength;
      if (config.bloomRadius !== undefined) this.bloomPass.radius = config.bloomRadius;
    }
    if (this.ssaoPass) {
      if (config.ssaoEnabled !== undefined) this.ssaoPass.enabled = config.ssaoEnabled;
      if (config.ssaoStrength !== undefined) this.ssaoPass.setAoStrength(config.ssaoStrength);
    }
    if (this.tiltShiftPass) {
      if (config.tiltShiftEnabled !== undefined) {
        this.tiltShiftPass.enabled = config.tiltShiftEnabled;
      }
      if (config.maxBlur !== undefined && this.tiltShiftPass.uniforms.uMaxBlur) {
        this.tiltShiftPass.uniforms.uMaxBlur.value = config.maxBlur;
      }
      if (
        config.vignetteStrength !== undefined &&
        this.tiltShiftPass.uniforms.uVignetteStrength
      ) {
        this.tiltShiftPass.uniforms.uVignetteStrength.value = config.vignetteStrength;
      }
    }
  }

  private ensureTorchPool(): void {
    if (this.torchPool.length >= MAX_ACTIVE_TORCH_LIGHTS) return;
    while (this.torchPool.length < MAX_ACTIVE_TORCH_LIGHTS) {
      const light = new THREE.PointLight(0xff9f40, 0, 17, 1.65);
      light.castShadow = false;
      light.visible = false;
      this.torchGroup.add(light);
      this.torchPool.push({ light, assignedIndex: -1 });
    }
  }

  /**
   * Enregistre les positions des torches dynamiques du donjon actif.
   * Les torches les plus proches de la caméra sont éclairées en temps réel par des
   * PointLights ambrées scintillantes (flicker organique) avec atténuation réaliste.
   */
  public setDynamicTorchLights(positions: readonly TorchLightPosition[]): void {
    this.torchSpecs = positions.map((pos, idx) => ({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      seed: idx * 2.17 + pos.x * 0.31 + pos.z * 0.19,
      intensity: pos.intensity ?? this.torchBaseIntensity,
      distance: pos.distance ?? 17,
      outdoor: pos.outdoor ?? false,
    }));

    if (this.torchSpecs.length === 0) {
      for (let index = 0; index < MAX_ACTIVE_TORCH_LIGHTS; index++) {
        clearSpriteLight(index);
      }
      for (const slot of this.torchPool) {
        slot.light.intensity = 0;
        slot.light.visible = false;
        slot.assignedIndex = -1;
      }
      return;
    }

    this.ensureTorchPool();
    this.updateDynamicTorches(this.effectTime);
  }

  private updateDynamicTorches(time: number): void {
    if (this.torchSpecs.length === 0 || this.torchPool.length === 0) return;

    const focusX = this.camLookAt.x;
    const focusZ = this.camLookAt.z;
    const slotsToRank = Math.min(this.torchPool.length, this.nearestTorchIndices.length);
    this.nearestTorchIndices.fill(-1);
    this.nearestTorchDistanceSq.fill(Number.POSITIVE_INFINITY);

    // Sélectionne les sources les plus proches dans des buffers réutilisés (aucune
    // allocation map/sort/objet par frame, même dans les grands donjons).
    for (let sourceIndex = 0; sourceIndex < this.torchSpecs.length; sourceIndex++) {
      const source = this.torchSpecs[sourceIndex];
      const dx = source.x - focusX;
      const dz = source.z - focusZ;
      const distSq = dx * dx + dz * dz;
      for (let rank = 0; rank < slotsToRank; rank++) {
        if (distSq >= this.nearestTorchDistanceSq[rank]) continue;
        for (let shift = slotsToRank - 1; shift > rank; shift--) {
          this.nearestTorchDistanceSq[shift] = this.nearestTorchDistanceSq[shift - 1];
          this.nearestTorchIndices[shift] = this.nearestTorchIndices[shift - 1];
        }
        this.nearestTorchDistanceSq[rank] = distSq;
        this.nearestTorchIndices[rank] = sourceIndex;
        break;
      }
    }

    let activeCount = 0;
    while (activeCount < slotsToRank && this.nearestTorchIndices[activeCount] >= 0) {
      activeCount++;
    }
    for (let i = 0; i < this.torchPool.length; i++) {
      const slot = this.torchPool[i];
      if (i >= activeCount) {
        slot.light.visible = false;
        slot.light.intensity = 0;
        slot.assignedIndex = -1;
        clearSpriteLight(i);
        continue;
      }

      const sourceIndex = this.nearestTorchIndices[i];
      const distSq = this.nearestTorchDistanceSq[i];
      const spec = this.torchSpecs[sourceIndex];
      slot.assignedIndex = sourceIndex;

      // Atténuation douce autour du rayon de la source, sans couper brutalement
      // les éclairages lorsque la caméra passe de l'un au suivant.
      const dist = Math.sqrt(distSq);
      const rangeFade = 1 - THREE.MathUtils.smoothstep(dist, spec.distance * 1.3, spec.distance * 2);
      if (rangeFade <= 0.01) {
        slot.light.visible = false;
        slot.light.intensity = 0;
        clearSpriteLight(i);
        continue;
      }

      // Scintillement organique multi-fréquence (flamme vivante de donjon)
      const s = spec.seed;
      const waveA = Math.sin(time * 9.3 + s);
      const waveB = Math.sin(time * 16.7 + s * 1.73) * 0.55;
      const waveC = Math.sin(time * 27.1 + s * 2.41) * 0.25;
      const flickerNorm = (waveA + waveB + waveC) / 1.8; // [-1, 1]

      const intensityFactor = 0.86 + flickerNorm * 0.22;
      slot.light.visible = true;
      slot.light.distance = spec.distance;
      const sourceBrightness = spec.outdoor
        ? this.outdoorLampBrightness * (0.98 + flickerNorm * 0.035)
        : intensityFactor;
      slot.light.intensity = spec.intensity * sourceBrightness * rangeFade;

      // Micro-danse de la flamme faisant vibrer les reflets sur les dalles PBR
      slot.light.position.set(
        spec.x + Math.sin(time * 11.4 + s) * 0.06,
        spec.y + Math.cos(time * 13.8 + s * 1.3) * 0.04,
        spec.z + Math.cos(time * 10.2 + s * 0.7) * 0.06,
      );

      // Modulation subtile de température de couleur (braise chaude <-> or ambré)
      if (flickerNorm >= 0) {
        this.torchColorScratch.copy(this.torchWarmColor).lerp(this.torchHotColor, flickerNorm * 0.45);
      } else {
        this.torchColorScratch.copy(this.torchWarmColor).lerp(this.torchEmberColor, -flickerNorm * 0.4);
      }
      slot.light.color.copy(this.torchColorScratch);
      setSpriteLight(i, slot.light.position, slot.light.color, slot.light.intensity, slot.light.distance);
    }
  }

  /**
   * Déplace le soleil directionnel et son frustum d'ombre 2048×2048 avec le joueur
   * en alignant sur la grille de texels d'ombre (zéro scintillement des bords d'ombre !).
   */
  private updateShadowFollow(targetX: number, targetZ: number, desiredExtent: number): void {
    const cam = this.dirLight.shadow.camera;
    if (Math.abs(this.currentShadowExtent - desiredExtent) > 0.5) {
      this.currentShadowExtent = desiredExtent;
      cam.left = -desiredExtent;
      cam.right = desiredExtent;
      cam.top = desiredExtent;
      cam.bottom = -desiredExtent;
      cam.updateProjectionMatrix();
    }

    // Alignement sur la grille des texels d'ombre pour des ombres 100 % stables en mouvement
    const worldUnitsPerTexel = (this.currentShadowExtent * 2) / SHADOW_MAP_SIZE;
    const snappedX = Math.round(targetX / worldUnitsPerTexel) * worldUnitsPerTexel;
    const snappedZ = Math.round(targetZ / worldUnitsPerTexel) * worldUnitsPerTexel;

    this.dirLight.target.position.set(snappedX, 0, snappedZ);
    this.dirLight.position.set(
      snappedX + this.dirLightOffset.x,
      this.dirLightOffset.y,
      snappedZ + this.dirLightOffset.z,
    );
    this.dirLight.target.updateMatrixWorld();
  }

  /**
   * Adapte ambiance lumineuse, couleur de fond, brume et tonalité des torches selon la zone active.
   */
  public setZoneLighting(zoneId: ZoneId): void {
    if (this.activeLightingZone === zoneId) return;
    this.activeLightingZone = zoneId;

    if (zoneId === 'overworld') {
      this.overworldBgColor.setHex(0x1b5e85);
      this.overworldFog.color.setHex(0x216b94);
      this.overworldFog.near = 115;
      this.overworldFog.far = 265;
      this.scene.background = this.overworldBgColor;
      this.scene.fog = this.overworldFog;

      // Lumière dorée diorama calibrée : ombres nettes (~39% contraste) sans faire bloomer la neige
      this.ambientLight.color.setHex(0xfff4e0);
      this.ambientLight.intensity = 0.28;

      this.hemiLight.color.setHex(0xb4e2ff);
      this.hemiLight.groundColor.setHex(0x637a3f);
      this.hemiLight.intensity = 0.32;

      this.dirLight.color.setHex(0xffe5ba);
      this.dirLight.intensity = 1.55;
      this.dirLightOffset.set(26, 42, 22);
      this.sunDirection.copy(this.dirLightOffset).normalize();

      // Pas de torches de donjon sur l'overworld
      this.setDynamicTorchLights([]);
      if (this.ssaoPass) {
        this.ssaoPass.setAoStrength(0.42);
      }
      this.updateShadowFollow(this.camLookAt.x, this.camLookAt.z, this.currentShadowExtent);
      return;
    }

    const dungeon = DUNGEONS[zoneId];
    const pal = DUNGEON_PALETTE[dungeon.theme];
    this.scene.background = new THREE.Color(pal.bgHex);

    if (dungeon.theme === 'ghost_cave') {
      this.scene.fog = new THREE.Fog(pal.bgHex, 48, 125);
      this.ambientLight.color.setHex(dungeon.ambientLightColor);
      this.ambientLight.intensity = 0.36;

      this.hemiLight.color.setHex(0x8899e6);
      this.hemiLight.groundColor.setHex(0x211836);
      this.hemiLight.intensity = 0.28;

      this.dirLight.color.setHex(0xd6c4ff);
      this.dirLight.intensity = 0.96;
      this.dirLightOffset.set(14, 34, 18);
      this.sunDirection.copy(this.dirLightOffset).normalize();

      this.torchWarmColor.setHex(0xffa64a);
      this.torchHotColor.setHex(0xffd578);
      this.torchEmberColor.setHex(0xff7729);
      this.torchBaseIntensity = 9.0;
    } else {
      this.scene.fog = new THREE.Fog(pal.bgHex, 52, 135);
      this.ambientLight.color.setHex(dungeon.ambientLightColor);
      this.ambientLight.intensity = 0.38;

      this.hemiLight.color.setHex(0xff9f70);
      this.hemiLight.groundColor.setHex(0x2e151d);
      this.hemiLight.intensity = 0.30;

      this.dirLight.color.setHex(0xffcfa3);
      this.dirLight.intensity = 1.05;
      this.dirLightOffset.set(16, 36, 20);
      this.sunDirection.copy(this.dirLightOffset).normalize();

      this.torchWarmColor.setHex(0xff8633);
      this.torchHotColor.setHex(0xffbe55);
      this.torchEmberColor.setHex(0xe8481c);
      this.torchBaseIntensity = 10.5;
    }

    if (this.ssaoPass) {
      this.ssaoPass.setAoStrength(0.55);
    }
    this.updateShadowFollow(this.camLookAt.x, this.camLookAt.z, SHADOW_EXTENT_GAMEPLAY);
  }

  /**
   * Ajoute une impulsion de tremblement d'écran (screen shake).
   */
  public addShake(amount: number): void {
    this.internalShake = Math.min(1.0, Math.max(this.internalShake, amount));
  }

  /**
   * Téléporte instantanément la caméra sur une position (utile lors d'un changement de zone).
   */
  public snapCameraTo(x: number, z: number, zoom = 1.0): void {
    this.currentZoom = zoom;
    this.maritimeLeadX = 0;
    this.maritimeLeadZ = 0;
    this.camPos.set(
      x,
      BASE_CAM_OFFSET_Y * zoom,
      z + BASE_CAM_OFFSET_Z * zoom,
    );
    this.camLookAt.set(x, LOOK_OFFSET_Y, z + LOOK_OFFSET_Z);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLookAt);
    this.cameraInitialized = true;
    this.updateShadowFollow(x, z, SHADOW_EXTENT_GAMEPLAY * Math.max(1, zoom));
  }

  private getTargetZoom(state: GameState): number {
    if (state.zoneId === 'overworld') {
      const mode = state.ship.mode;
      if (mode === 'sailing') {
        const speedRatio = THREE.MathUtils.clamp(Math.abs(state.ship.speed) / 13.5, 0, 1);
        return 1.22 + 0.14 * speedRatio;
      }
      if (mode === 'boarding' || mode === 'docking') {
        return 1.14;
      }
      if (mode === 'disembarking') {
        return 1.04;
      }
    }
    if (state.dialogue.active || state.inVillage) {
      return 0.85;
    }
    if (
      state.zoneId === 'dungeon_dragon_lair' &&
      (state.activeBossId !== null || state.player.z < 7)
    ) {
      return 1.15;
    }
    return 1.0;
  }

  /**
   * Anime le post-processing (Tilt-Shift) et le scintillement dynamique des torches de donjon.
   */
  public update(dt: number): void {
    const safeDt = Math.min(Math.max(dt, 0), 0.05);
    this.effectTime += safeDt;

    if (this.tiltShiftPass && this.tiltShiftPass.uniforms.uTime) {
      this.tiltShiftPass.uniforms.uTime.value = this.effectTime;
    }

    this.updateDynamicTorches(this.effectTime);
    this.updatedSinceLastRender = true;
  }

  /**
   * Met à jour la caméra 2.5D : orbite douce sur l'Écran Titre, suivi amorti en jeu,
   * zoom contextuel (village/dialogue 0.85, boss 1.15), suivi de la shadow camera
   * et screen shake actif même pendant le hitstop.
   */
  public updateCamera(state: GameState, dt: number): void {
    const safeDt = Math.min(Math.max(dt, 0.0001), 0.05);
    this.lastCameraDt = safeDt;
    this.setZoneLighting(state.zoneId);

    // Orbite panoramique douce au-dessus de l'île pour l'Écran Titre
    if (state.screen === 'title') {
      this.titleOrbitAngle += safeDt * 0.14;
      const orbitRadius = 35;
      const centerX = 0;
      const centerZ = 6;
      const targetX = centerX + Math.sin(this.titleOrbitAngle) * orbitRadius;
      const targetZ = centerZ + Math.cos(this.titleOrbitAngle) * orbitRadius;
      const targetY = 25 + Math.sin(this.titleOrbitAngle * 1.5) * 1.8;

      if (!this.cameraInitialized || this.lastScreen !== 'title') {
        this.camPos.set(targetX, targetY, targetZ);
        this.camLookAt.set(centerX, 0.5, centerZ);
        this.cameraInitialized = true;
      } else {
        const alpha = 1 - Math.exp(-3.5 * safeDt);
        this.tempVec.set(targetX, targetY, targetZ);
        this.camPos.lerp(this.tempVec, alpha);
        this.tempVec.set(centerX, 0.5, centerZ);
        this.camLookAt.lerp(this.tempVec, alpha);
      }

      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLookAt);
      this.updateShadowFollow(centerX, centerZ, SHADOW_EXTENT_TITLE);
      this.lastScreen = state.screen;
      return;
    }

    const isMaritime =
      state.zoneId === 'overworld' && state.ship.mode !== 'parked';
    const targetZoom = this.getTargetZoom(state);
    const zoomRate = isMaritime ? 3.2 : 5.0;
    const zoomAlpha = 1 - Math.exp(-zoomRate * safeDt);
    this.currentZoom += (targetZoom - this.currentZoom) * zoomAlpha;

    // Cible horizontale lissée : anticipation douce de vitesse en navigation & cadrage rivage à l'accostage
    let focusX = state.player.x;
    let focusZ = state.player.z;
    let desiredLeadX = 0;
    let desiredLeadZ = 0;

    if (state.zoneId === 'overworld') {
      if (state.ship.mode === 'sailing') {
        focusX = state.ship.position.x;
        focusZ = state.ship.position.z;
        desiredLeadX = THREE.MathUtils.clamp(state.ship.vx * 0.24, -3.6, 3.6);
        desiredLeadZ = THREE.MathUtils.clamp(state.ship.vz * 0.2, -3.0, 3.0);
      } else if (state.ship.mode === 'docking') {
        const land = state.ship.transition?.landingPos;
        if (land) {
          focusX = state.ship.position.x * 0.72 + land.x * 0.28;
          focusZ = state.ship.position.z * 0.72 + land.z * 0.28;
        } else {
          focusX = state.ship.position.x;
          focusZ = state.ship.position.z;
        }
      } else if (
        state.ship.mode === 'boarding' ||
        state.ship.mode === 'disembarking'
      ) {
        focusX = state.player.x * 0.65 + state.ship.position.x * 0.35;
        focusZ = state.player.z * 0.65 + state.ship.position.z * 0.35;
      }
    }

    const leadAlpha = 1 - Math.exp(-3.0 * safeDt);
    this.maritimeLeadX += (desiredLeadX - this.maritimeLeadX) * leadAlpha;
    this.maritimeLeadZ += (desiredLeadZ - this.maritimeLeadZ) * leadAlpha;

    const targetX = focusX + this.maritimeLeadX;
    const targetZ = focusZ + this.maritimeLeadZ;

    const desiredPosX = targetX;
    const desiredPosY = BASE_CAM_OFFSET_Y * this.currentZoom;
    const desiredPosZ = targetZ + BASE_CAM_OFFSET_Z * this.currentZoom;
    const desiredLookX = targetX;
    const desiredLookY = LOOK_OFFSET_Y;
    const desiredLookZ = targetZ + LOOK_OFFSET_Z;

    const distSq =
      (desiredLookX - this.camLookAt.x) ** 2 +
      (desiredLookZ - this.camLookAt.z) ** 2;

    // Snap si on sort de l'écran titre ou lors d'une téléportation / transition de zone
    if (!this.cameraInitialized || this.lastScreen === 'title' || distSq > 400) {
      this.snapCameraTo(targetX, targetZ, targetZoom);
    } else {
      const followRate = isMaritime ? 5.8 : 8.0;
      const followAlpha = 1 - Math.exp(-followRate * safeDt);
      this.camPos.x += (desiredPosX - this.camPos.x) * followAlpha;
      this.camPos.y += (desiredPosY - this.camPos.y) * followAlpha;
      this.camPos.z += (desiredPosZ - this.camPos.z) * followAlpha;

      this.camLookAt.x += (desiredLookX - this.camLookAt.x) * followAlpha;
      this.camLookAt.y += (desiredLookY - this.camLookAt.y) * followAlpha;
      this.camLookAt.z += (desiredLookZ - this.camLookAt.z) * followAlpha;
    }

    this.lastScreen = state.screen;

    // Décroissance & application du screen shake
    this.internalShake = Math.max(0, this.internalShake - safeDt * 2.8);
    const shakeStrength = Math.max(this.internalShake, state.screenShake);
    this.shakeClock += safeDt * 58;

    let shakeX = 0;
    let shakeY = 0;
    if (shakeStrength > 0.002) {
      const amp = shakeStrength * 0.72;
      shakeX = Math.sin(this.shakeClock * 1.3) * amp;
      shakeY = Math.cos(this.shakeClock * 1.9) * amp * 0.75;
    }

    this.camera.position.set(
      this.camPos.x + shakeX,
      this.camPos.y + shakeY,
      this.camPos.z,
    );
    this.camera.lookAt(
      this.camLookAt.x + shakeX * 0.45,
      this.camLookAt.y + shakeY * 0.45,
      this.camLookAt.z,
    );

    // Suivi du soleil directionnel 2048×2048 autour du focus pour des ombres ultra-nettes
    const shadowExtent = SHADOW_EXTENT_GAMEPLAY * Math.max(0.95, this.currentZoom);
    this.updateShadowFollow(this.camLookAt.x, this.camLookAt.z, shadowExtent);
  }

  /**
   * Convertit des coordonnées normalisées NDC ([-1, 1]) vers le plan logique `y = 0`.
   */
  public ndcToWorld(ndcX: number, ndcY: number): Vec2 | null {
    this.pointerNdc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.rayHit);
    if (!hit) return null;

    return { x: hit.x, z: hit.z };
  }

  /**
   * Convertit des coordonnées souris écran (clientX, clientY) vers le plan logique `y = 0`.
   */
  public screenToWorld(clientX: number, clientY: number): Vec2 | null {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    return this.ndcToWorld(ndcX, ndcY);
  }

  /**
   * Projette un point 3D du monde vers des coordonnées 2D en pixels dans le conteneur.
   */
  public worldToScreen(x: number, y: number, z: number): ProjectedPoint {
    this.projVec.set(x, y, z);
    this.projVec.project(this.camera);

    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    const visible = this.projVec.z >= -1 && this.projVec.z <= 1;

    return {
      x: (this.projVec.x * 0.5 + 0.5) * width,
      y: (-this.projVec.y * 0.5 + 0.5) * height,
      visible,
    };
  }

  /**
   * Rend la scène via le pipeline Post-Processing (EffectComposer) ou en fallback direct.
   * Rétrocompatible : `render()` sans argument ou `render(dt)` avec delta-time.
   */
  public render(dt?: number): void {
    const stepDt = dt !== undefined ? dt : this.lastCameraDt;
    if (dt !== undefined || !this.updatedSinceLastRender) {
      this.update(stepDt);
    }
    this.updatedSinceLastRender = false;

    if (this.postProcessingActive && this.composer) {
      this.composer.render(stepDt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  public resize(): void {
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);
    const pixelRatio = this.getPixelRatio();

    const aspect = width / height;
    this.camera.aspect = aspect;
    this.camera.fov = computeResponsiveFov(aspect);
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);

    if (this.composer) {
      this.composer.setPixelRatio(pixelRatio);
      this.composer.setSize(width, height);
    }

    const effW = Math.max(1, Math.floor(width * pixelRatio));
    const effH = Math.max(1, Math.floor(height * pixelRatio));

    if (this.tiltShiftPass) {
      updateTiltShiftResolution(this.tiltShiftPass, effW, effH);
    }
    if (this.ssaoPass) {
      this.ssaoPass.setSize(effW, effH);
    }
  }

  public dispose(): void {
    window.removeEventListener('resize', this.boundResize);

    for (const slot of this.torchPool) {
      this.torchGroup.remove(slot.light);
    }
    this.torchPool.length = 0;
    this.torchSpecs.length = 0;
    this.scene.remove(this.torchGroup);

    this.disposePostProcessing();
    this.renderer.dispose();

    if (this.domElement.parentNode === this.container) {
      this.container.removeChild(this.domElement);
    }
  }
}
