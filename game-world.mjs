import * as THREE from './three.webgpu.min.js';
import { REGIONS, CONNECTIONS, regionUnlocked } from './game-core.mjs';

const TAU = Math.PI * 2;
const discardedCallback = () => {};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const distanceToSegment = (x, z, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
};

function themePalette() {
  const style = getComputedStyle(document.documentElement);
  const keys = ['bg','bg-elevated','surface','surface-soft','border','border-strong','text','text-muted','text-soft','accent','accent-hover','accent-fg','success','warning','danger','link'];
  return Object.fromEntries(keys.map(key => {
    const value = style.getPropertyValue(`--cp-${key}`).trim();
    if (!value) throw new Error(`Missing theme token --cp-${key}. The scene cannot choose an unrelated palette.`);
    return [key, new THREE.Color(value)];
  }));
}

export class GameRendererError extends Error {
  constructor(message, cause) { super(message,{cause}); this.name='GameRendererError'; }
}
export class GameLocationError extends Error {}

function boundedInitialization(promise, signal, lateCleanup = () => {}) {
  return new Promise((resolve,reject) => {
    let abandoned=false;
    const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);};
    const cancel=()=>{abandoned=true;finish();reject(new GameRendererError('Renderer initialization cancelled.'));};
    const timer=setTimeout(()=>{abandoned=true;finish();reject(new GameRendererError('Renderer initialization timed out.'));},12000);
    signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted) cancel();
    promise.then(value=>{finish();if(abandoned)lateCleanup(value);else resolve(value);},
      error=>{finish();if(!abandoned)reject(error);});
  });
}

export async function createWorld({ canvas, state:initialState, reducedMotion = false, rendererPreference = 'auto', signal,
  onNear = () => {}, onInteract = () => {}, onContextLost = () => {}, onMarkers = () => {} }) {
  if (!canvas || !canvas.isConnected) throw new Error('The 3D canvas is not mounted.');
  const palette = themePalette();
  if(!['auto','webgl'].includes(rendererPreference)) throw new Error('Unknown renderer preference.');
  let device,adapterInfo=null,fallbackReason='';
  if(rendererPreference!=='webgl' && navigator.gpu) {
    try {
      const adapter=await boundedInitialization(navigator.gpu.requestAdapter({powerPreference:'low-power'}),signal);
      if(adapter) {
        device=await boundedInitialization(adapter.requestDevice(),signal,value=>value.destroy());
        const info=adapter.info;
        adapterInfo={vendor:info?.vendor||'',architecture:info?.architecture||'',device:info?.device||'',
          description:info?.description||'',isFallbackAdapter:adapter.isFallbackAdapter ?? null};
      } else fallbackReason='No WebGPU adapter was available; using WebGL2 compatibility.';
    } catch(error) {
      if(signal?.aborted) throw error;
      if(!(error instanceof DOMException) && !(error instanceof TypeError) && !(error instanceof GameRendererError)) throw error;
      fallbackReason=`WebGPU initialization unavailable: ${error.message} Using WebGL2 compatibility.`;
    }
  } else fallbackReason=rendererPreference==='webgl'?'WebGL2 compatibility was selected.':'WebGPU is not exposed by this browser; using WebGL2 compatibility.';
  const renderer = new THREE.WebGPURenderer({ canvas, antialias:true, alpha:false, powerPreference:'low-power',
    device,forceWebGL:!device,colorBufferType:THREE.UnsignedByteType });
  try {
    await boundedInitialization(renderer.init(),signal,value=>value.dispose());
  } catch(error) {
    device?.destroy();
    throw new GameRendererError(`The 3D backend could not initialize: ${error.message}`,error);
  }
  const api=renderer.backend.isWebGPUBackend ? 'WebGPU':'WebGL2';
  if(api==='WebGL2' && device) {
    device.destroy();device=undefined;
    fallbackReason='WebGPU backend initialization failed; Three.js initialized its WebGL2 fallback.';
  }
  if(api==='WebGL2') {
    const gl=renderer.getContext(),extension=gl.getExtension('WEBGL_debug_renderer_info');
    adapterInfo={description:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
      vendor:extension?gl.getParameter(extension.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),isFallbackAdapter:null};
  }
  const reportedAdapter=Object.values(adapterInfo||{}).filter(value=>typeof value==='string').join(' ');
  const adapterScope=adapterInfo?.isFallbackAdapter===true || /swiftshader|llvmpipe|software|basic render|warp/i.test(reportedAdapter)
    ? 'Software/fallback adapter reported'
    : reportedAdapter.trim() ? 'Adapter-reported device; not an independent hardware certification':'Adapter details not exposed; hardware/software scope unknown';
  renderer.info.autoReset=false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = document.documentElement.dataset.theme === 'dark' ? 1.35 : .9;
  const scene = new THREE.Scene();
  scene.background = palette.bg.clone();
  scene.fog = new THREE.Fog(palette.bg, 75, 185);
  const camera = new THREE.PerspectiveCamera(55, 1, .2, 240);
  const lightColor = palette.surface.clone().lerp(palette.text, .5);
  lightColor.multiplyScalar(1 / Math.max(.05, lightColor.r, lightColor.g, lightColor.b));
  const ambient = new THREE.HemisphereLight(lightColor, palette['border-strong'], .85);
  const sun = new THREE.DirectionalLight(lightColor, 1.6);
  sun.position.set(-35, 65, 20);
  scene.add(ambient, sun);

  const geometries = new Map();
  const materials = new Map();
  const ownedMaterials = new Set();
  const geometriesByName = {
    box:() => new THREE.BoxGeometry(1,1,1),
    cylinder:() => new THREE.CylinderGeometry(1,1,1,16),
    column:() => new THREE.CylinderGeometry(1,1,1,8),
    island:() => new THREE.CylinderGeometry(1,.96,1,48),
    cone:() => new THREE.ConeGeometry(1,1,12),
    sphere:() => new THREE.SphereGeometry(1,12,8),
    ring:() => new THREE.TorusGeometry(1,.075,6,28),
    pipe:() => new THREE.CylinderGeometry(1,1,1,8),
    disk:() => new THREE.CircleGeometry(1,24),
  };
  const geometry = name => {
    if (!geometries.has(name)) geometries.set(name, geometriesByName[name]());
    return geometries.get(name);
  };
  function material(token, lit = false, opacity = 1) {
    const key = `${token}:${lit}:${opacity}`;
    if (!materials.has(key)) {
      const value = new THREE.MeshStandardMaterial({
        color:palette[token], roughness:.78, metalness:lit ? .22 : .06,
        emissive:palette[token], emissiveIntensity:lit ? .55 : 0,
        transparent:opacity < 1, opacity, side:THREE.DoubleSide,
      });
      materials.set(key, value);
      ownedMaterials.add(value);
    }
    return materials.get(key);
  }
  const dummy = new THREE.Object3D();
  const obstacles=[];
  const byId = new Map(REGIONS.map(region => [region.id, region]));
  function matrixAt(x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    dummy.position.set(x,y,z); dummy.scale.set(sx,sy,sz); dummy.rotation.set(rx,ry,rz);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  }
  function batchBuilder(parent) {
    const batches = new Map();
    return {
      block(x,z,width,depth) {
        const point=parent.localToWorld(new THREE.Vector3(x,0,z));
        obstacles.push({x:point.x,z:point.z,width,depth,owner:parent});
      },
      add(kind, token, x,y,z, sx=1,sy=1,sz=1, rx=0,ry=0,rz=0, lit=false) {
        const key = `${kind}:${token}:${lit}`;
        if (!batches.has(key)) batches.set(key, { kind, token, lit, matrices:[] });
        batches.get(key).matrices.push(matrixAt(x,y,z,sx,sy,sz,rx,ry,rz));
      },
      flush() {
        for (const batch of batches.values()) {
          const mesh = new THREE.InstancedMesh(geometry(batch.kind), material(batch.token,batch.lit), batch.matrices.length);
          batch.matrices.forEach((matrix,index) => mesh.setMatrixAt(index,matrix));
          mesh.computeBoundingSphere();
          parent.add(mesh);
        }
        batches.clear();
      },
    };
  }
  function mesh(kind, token, x,y,z, sx=1,sy=1,sz=1, parent=scene, lit=false) {
    const result = new THREE.Mesh(geometry(kind), material(token,lit));
    result.position.set(x,y,z); result.scale.set(sx,sy,sz);
    parent.add(result);
    return result;
  }

  const ground = mesh('box','bg-elevated',0,-2.2,-5,280,1,270);
  ground.name = 'quiet-water';
  const terrain = batchBuilder(scene);
  for (const region of REGIONS) {
    terrain.add('island','border-strong',region.x,-1.05,region.z,22,2,20);
    terrain.add('island','surface-soft',region.x,-.03,region.z,21.7,.08,19.7);
    terrain.add('cylinder','bg-elevated',region.x,.04,region.z+7,4,.09,4);
  }
  const connections = [];
  for (const [aId,bId] of CONNECTIONS) {
    const a = byId.get(aId), b = byId.get(bId);
    const length = Math.hypot(a.x-b.x,a.z-b.z), angle = Math.atan2(b.x-a.x,b.z-a.z);
    const x = (a.x+b.x)/2, z = (a.z+b.z)/2;
    terrain.add('box','surface-soft',x,.03,z,7.6,.32,length,0,angle);
    terrain.add('box','border-strong',x + Math.cos(angle)*3.65,.35,z-Math.sin(angle)*3.65,.13,.7,length,0,angle);
    terrain.add('box','border-strong',x - Math.cos(angle)*3.65,.35,z+Math.sin(angle)*3.65,.13,.7,length,0,angle);
    const line = mesh('box','accent',x,.21,z,.1,.03,length,scene,true);
    line.rotation.y = angle;
    connections.push({ a:aId,b:bId,line });
  }
  terrain.flush();

  const regionViews = new Map();
  const animated = [];
  let state = initialState;
  function tree(builder, x, z, scale = 1) {
    builder.add('column','border-strong',x,1.25*scale,z,.17*scale,2.5*scale,.17*scale);
    builder.add('sphere','text-muted',x,3.0*scale,z,1.15*scale,1.4*scale,1.15*scale);
    builder.add('sphere','border',x+.4*scale,3.6*scale,z-.2*scale,.65*scale,.7*scale,.7*scale);
  }
  function house(builder,x,z,scale=1) {
    builder.block(x,z,3*scale,2.7*scale);
    builder.add('box','border-strong',x,.05,z,3.35*scale,.045,3.1*scale);
    builder.add('box','surface',x,1.4*scale,z,3*scale,2.8*scale,2.7*scale);
    builder.add('cone','border-strong',x,3.25*scale,z,2.3*scale,1.2*scale,2.3*scale,0,Math.PI/4);
    builder.add('box','accent',x,1.5*scale,z+1.37*scale,.62*scale,1.2*scale,.04,0,0,0,true);
  }
  function robot(builder,x,z,scale=1) {
    builder.add('column','border-strong',x,.35,z,1,.7,1);
    builder.add('box','surface',x,1.55*scale,z,.65*scale,2*scale,.65*scale,0,0,-.25);
    builder.add('sphere','accent',x+.25,2.45*scale,z,.45,.45,.45,0,0,0,true);
    builder.add('box','surface',x+1.1*scale,2.8*scale,z,1.7*scale,.45*scale,.5*scale,0,0,.4);
    builder.add('box','border-strong',x+1.85*scale,2.5*scale,z,.25,.7,.6);
  }

  for (const region of REGIONS) {
    const group = new THREE.Group(); group.position.set(region.x,0,region.z); scene.add(group);
    const detail = new THREE.Group(); group.add(detail);
    const b = batchBuilder(detail);
    const marker = new THREE.Group(); marker.position.set(0,3.2,7); group.add(marker);
    if(region.id==='commons') mesh('ring','accent',0,0,0,1,1,1,marker,true);
    else if(region.id==='foundry') {
      for(const side of [-1,1]) {
        mesh('box','accent',side,0,0,.13,2,.13,marker,true);
        mesh('box','accent',0,side,0,2,.13,.13,marker,true);
      }
    } else if(region.id==='power') {
      for(let i=0;i<3;i++) mesh('box','accent',-.6+i*.6,-.25+i*.2,0,.25,1.2+i*.3,.18,marker,true);
    } else if(region.id==='work') {
      mesh('ring','accent',0,0,0,.72,.72,.72,marker,true);
      for(let i=0;i<8;i++) {
        const a=i/8*TAU;
        const tooth=mesh('box','accent',Math.cos(a)*.9,Math.sin(a)*.9,0,.36,.2,.2,marker,true);
        tooth.rotation.z=a;
      }
    } else if(region.id==='civic') {
      for(let i=0;i<3;i++) {
        const a=i/3*TAU;
        const bar=mesh('box','accent',Math.sin(a)*.55,Math.cos(a)*.55,0,1.9,.13,.13,marker,true);
        bar.rotation.z=-a;
      }
    } else if(region.id==='distribution') {
      mesh('box','accent',0,-.4,0,.15,1.2,.15,marker,true);
      for(const side of [-1,1]) {
        const branch=mesh('box','accent',side*.4,.35,0,1.2,.15,.15,marker,true);
        branch.rotation.z=side*.55;
        mesh('sphere','accent',side*.9,.65,0,.2,.2,.2,marker,true);
      }
    } else {
      mesh('ring','accent',0,0,0,1,1,1,marker,true);
      const orbit=mesh('ring','accent',0,0,0,1.1,1.1,1.1,marker,true);orbit.rotation.y=1.1;
    }
    const post = mesh('column','border-strong',0,1.15,7,.22,2.3,.22,group);
    mesh('cylinder','surface',0,.5,7,1.3,1,1.3,group);
    mesh('cylinder','accent',0,1.02,7,1.1,.08,1.1,group,true);
    const signalMaterial = material('accent',true).clone();
    ownedMaterials.add(signalMaterial);
    const signal = new THREE.Mesh(geometry('sphere'),signalMaterial);
    signal.position.set(0,3.2,7); signal.scale.setScalar(.22); group.add(signal);
    const wayfinder = mesh('box','accent',0,.16,11,1.8,.05,4.4,group,true);
    const growth = new THREE.Group(); group.add(growth);
    let programDisplay=null;
    const growthBatch = batchBuilder(growth);
    for (let i=0;i<5;i++) house(growthBatch,-12+i*5,12,.65);
    growthBatch.flush();

    if (region.form === 'commons') {
      b.block(0,-5,10.5,10.5);
      b.add('cylinder','surface',0,2.4,-5,5.8,4.8,5.8);
      b.add('cylinder','border',0,4.9,-5,6.6,.25,6.6);
      b.add('cone','bg-elevated',0,6.0,-5,6.0,2.0,6.0);
      for (let i=0;i<12;i++) {
        const a=i/12*TAU;
        b.add('column','border-strong',Math.cos(a)*5.85,2.3,-5+Math.sin(a)*5.85,.22,4.6,.22);
        b.add('box','accent',Math.cos(a)*5.95,2.6,-5+Math.sin(a)*5.95,.65,1.6,.06,0,-a+Math.PI/2,0,true);
      }
      for (const [x,z] of [[-12,0],[11,-1],[-11,-11],[12,-11]]) house(b,x,z,.85);
      for (const [x,z] of [[-7,5],[8,4],[-14,8],[14,8]]) tree(b,x,z,.85);
      b.add('cylinder','accent',-7,.14,5,2.5,.12,2.5);
    } else if (region.form === 'foundry') {
      for (let i=0;i<4;i++) {
        const x=-11+i*7.3;
        b.block(x,-6,5.8,9);
        b.add('box','surface',x,3.5,-6,5.8,7,9);
        b.add('box','border-strong',x,7.1,-6,6,.25,9.3);
        for(let y=0;y<4;y++) b.add('box','accent',x,1.2+y*1.45,-1.44,4.8,.13,.1,0,0,0,true);
        b.add('cylinder','text-muted',x,8,-6,1.4,1.5,1.4);
      }
      for(let i=0;i<3;i++) {
        b.add('column','border-strong',-11+i*10,2.2,2,.3,4.4,.3);
        b.add('box','border-strong',-6+i*10,4.6,2,10,.5,.6);
        robot(b,-10+i*9,1,.7);
      }
    } else if (region.form === 'power') {
      for(let row=0;row<3;row++) for(let col=0;col<5;col++) {
        const x=-13+col*4.4,z=-12+row*4.2;
        b.add('column','border-strong',x,1.1,z,.13,2.2,.13);
        b.add('box','text-soft',x,2.1,z,3.5,.13,2.8,-.25,0,0);
        b.add('box','accent',x,2.2,z,3.5,.03,.12,-.25,0,0,true);
      }
      for(const x of [-12,12]) {
        b.add('column','surface',x,6,2,.35,12,.35);
        const blades=new THREE.Group(); blades.position.set(x,12,2); detail.add(blades);
        for(let i=0;i<3;i++) {
          const blade=mesh('box','surface-soft',0,2,0,.5,4,.18,blades);
          const pivot=new THREE.Group(); blades.remove(blade); pivot.add(blade); pivot.rotation.z=i/3*TAU; blades.add(pivot);
        }
        animated.push({ object:blades, axis:'z', speed:.35, region:region.id });
      }
      b.add('cylinder','surface',0,2.3,1,3.2,4.6,3.2);
      b.block(0,1,5.8,5.8);
      b.add('ring','accent',0,4.7,1,3.3,3.3,3.3,Math.PI/2,0,0,true);
    } else if (region.form === 'work') {
      for(let i=0;i<4;i++) {
        const x=-12+i*8;
        b.block(x,-7,6.2,8);
        b.add('box','surface',x,2,-7,6.2,4,8);
        b.add('box','border',x,4.15,-7,7,.3,8.8);
        b.add('box','accent',x,2.6,-2.94,4.5,.15,.12,0,0,0,true);
        robot(b,x,0,.85);
      }
      b.add('box','border-strong',0,.55,3,29,1.1,2.4);
      for(let i=0;i<8;i++) b.add('box','surface-soft',-12+i*3.5,1.4,3,1.3,.65,1.2);
      for(const x of [-13,13]) tree(b,x,8,.9);
    } else if (region.form === 'civic') {
      for(let i=0;i<4;i++) b.add('cylinder',i%2?'surface':'border',0,.35+i*.65,-5,11-i*1.2,.65,9-i*.7);
      for(let i=0;i<10;i++) {
        const a=(i/9)*Math.PI;
        b.add('column','surface',Math.cos(a)*8,5.5,-5-Math.sin(a)*7,.6,6,.6);
      }
      b.add('box','surface',0,8.7,-9,18,.5,3);
      b.add('ring','accent',0,6.1,-8,3.8,3.8,3.8,0,0,0,true);
      for(let i=0;i<3;i++) {
        b.add('column','border-strong',-8+i*8,1.5,4,.5,3,.5);
        b.add('sphere','accent',-8+i*8,3.3,4,.5,.5,.5,0,0,0,true);
      }
    } else if (region.form === 'distribution') {
      for(let i=0;i<3;i++) {
        const x=-12+i*12;
        b.add('box','bg-elevated',x,.1,-4,2.8,.16,21);
        b.add('box','accent',x,.21,-4,.12,.06,21,0,0,0,true);
        for(let j=0;j<3;j++) house(b,x+(j%2?3.2:-3.2),-12+j*7,.65);
        b.add('box','surface',x,.32,2,5,.3,2);
      }
      b.add('sphere','surface',0,3,-10,4,3.5,4);
      b.add('ring','accent',0,3.3,-10,4.1,4.1,4.1,Math.PI/2,0,0,true);
      for(const x of [-16,16]) tree(b,x,8,.9);
    } else if (region.form === 'frontier') {
      b.block(0,-5,11,11);
      b.add('cylinder','surface',0,2.6,-5,6,5.2,6);
      b.add('sphere','border',0,5.1,-5,6.1,4,6.1);
      b.add('box','text-muted',0,6.7,-1.2,1.4,2.3,6,-.4,0,0);
      for(let i=0;i<7;i++) {
        const a=i/7*TAU,x=Math.cos(a)*14,z=-3+Math.sin(a)*12;
        b.add('column','border-strong',x,1.4,z,.22,2.8,.22);
        b.add(i%2?'ring':'sphere','accent',x,3.2,z,.8,.8,.8,0,a,0,true);
      }
      const orbit=new THREE.Group(); orbit.position.set(0,13,-5); detail.add(orbit);
      programDisplay=orbit;
      const ring=mesh('ring','accent',0,0,0,5,5,5,orbit,true); ring.rotation.x=.9; ring.rotation.z=.25;
      mesh('sphere','surface-soft',0,0,0,1.6,1.6,1.6,orbit);
      mesh('sphere','accent',5,0,0,.35,.35,.35,orbit,true);
      animated.push({ object:orbit,axis:'y',speed:.12,region:region.id });
    }
    b.flush();
    const taskLines = [];
    for(let i=0;i<3;i++) {
      const line=mesh('box','accent',-3+i*3,.17,7,2.5,.045,.15,group,true);
      taskLines.push(line);
    }
    regionViews.set(region.id,{ group,detail,marker,post,signal,signalMaterial,wayfinder,growth,taskLines,programDisplay });
  }

  const avatar = new THREE.Group(); scene.add(avatar);
  mesh('cylinder','accent',0,1.05,0,.38,1.25,.38,avatar);
  mesh('sphere','text',0,1.95,0,.31,.31,.31,avatar);
  mesh('box','surface',0,1.15,.32,.5,.7,.24,avatar);
  const legs = [-1,1].map(side => mesh('box','text-muted',side*.2,.33,0,.22,.65,.24,avatar));
  const shadow=mesh('disk','border-strong',0,.05,0,.72,.72,.72,avatar);
  shadow.rotation.x=-Math.PI/2;
  let x=0,z=13,yaw=0,pitch=.48,zoom=13;
  let running=false,disposed=false,paused=false,lost=false,frame=0,last=0,elapsed=0;
  let nearest='',moveX=0,moveZ=0,drag=null,quality=canvas.clientWidth < 720 ? 'low':'standard';
  const abort = new AbortController();
  const keys = new Set();
  const frameTimes = [];
  let renderedFrames=0;

  function isWalkable(nx,nz) {
    const supported=REGIONS.some(region => Math.hypot((nx-region.x)/22,(nz-region.z)/20) <= 1) ||
      CONNECTIONS.some(([a,b]) => distanceToSegment(nx,nz,byId.get(a),byId.get(b)) <= 3.4);
    return supported&&!obstacles.some(item=>item.owner.visible &&
      Math.abs(nx-item.x)<item.width/2+.28 && Math.abs(nz-item.z)<item.depth/2+.28);
  }
  function resize() {
    if(disposed) return;
    const width=Math.max(1,canvas.clientWidth),height=Math.max(1,canvas.clientHeight);
    const mobile=width < 720,limit=mobile?700000:2000000;
    const dpr=Math.min(devicePixelRatio || 1,mobile?1:1.5,Math.sqrt(limit/(width*height)),quality==='low'?1:1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width,height,false);
    camera.aspect=width/height; camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas);
  function updateCamera() {
    const horizontal=Math.cos(pitch)*zoom;
    camera.position.set(x+Math.sin(yaw)*horizontal,1.8+Math.sin(pitch)*zoom,z+Math.cos(yaw)*horizontal);
    camera.lookAt(x,1.65,z);
  }
  function updateNearby() {
    let next='',best=7;
    for(const region of REGIONS) {
      const dist=Math.hypot(x-region.x,z-region.z-7);
      if(dist<best){best=dist;next=region.id;}
    }
    if(next!==nearest){nearest=next;onNear(next);}
  }
  function draw(now) {
    if(disposed || paused || !running) return;
    const measuredFrameMs=now-last;
    const dt=Math.min(measuredFrameMs/1000 || .016,.05); last=now;
    elapsed+=dt;
    let sx=moveX,sz=moveZ;
    if(keys.has('w')||keys.has('arrowup')) sz-=1;
    if(keys.has('s')||keys.has('arrowdown')) sz+=1;
    if(keys.has('a')||keys.has('arrowleft')) sx-=1;
    if(keys.has('d')||keys.has('arrowright')) sx+=1;
    if(keys.has('q')) yaw+=dt*1.6;
    if(keys.has('e')) yaw-=dt*1.6;
    const length=Math.hypot(sx,sz);
    if(length>1){sx/=length;sz/=length;}
    const speed=keys.has('shift')?10:6.5;
    const dx=(Math.cos(yaw)*sx+Math.sin(yaw)*sz)*dt*speed;
    const dz=(-Math.sin(yaw)*sx+Math.cos(yaw)*sz)*dt*speed;
    if(isWalkable(x+dx,z)) x+=dx;
    if(isWalkable(x,z+dz)) z+=dz;
    avatar.position.set(x,.15,z);
    if(length>.01) avatar.rotation.y=Math.atan2(dx,dz);
    legs.forEach((leg,index)=>{leg.rotation.x=!reducedMotion&&length>.01?Math.sin(elapsed*10+index*Math.PI)*.35:0;});
    for(const item of animated) if(!reducedMotion) item.object.rotation[item.axis]+=dt*item.speed;
    for(const [id,view] of regionViews) {
      const r=byId.get(id);
      view.detail.visible=Math.hypot(x-r.x,z-r.z) < (quality==='low'?72:115);
      view.marker.scale.setScalar(id===nearest?1.7:1.5);
    }
    updateCamera(); updateNearby(); renderer.info.reset(); renderer.render(scene,camera); renderedFrames++;
    if(measuredFrameMs>0) frameTimes.push(measuredFrameMs);
    if(renderedFrames%8===0) {
      onMarkers(REGIONS.map(region=>{
        const point=new THREE.Vector3(region.x,5.8,region.z+7).project(camera);
        return{id:region.id,name:region.short,x:(point.x+1)/2,y:(1-point.y)/2,
          visible:point.z>-1&&point.z<1&&Math.abs(point.x)<.95&&Math.abs(point.y)<.9};
      }));
    }
    if(frameTimes.length>180) frameTimes.shift();
    if(quality==='standard'&&frameTimes.length>=120) {
      const sorted=[...frameTimes].sort((a,b)=>a-b);
      if(sorted[Math.floor(sorted.length*.95)]>33.4){quality='low';resize();}
    }
    frame=requestAnimationFrame(draw);
  }
  function stop() {
    running=false;cancelAnimationFrame(frame);keys.clear();moveX=moveZ=0;drag=null;
  }
  function start() {
    if(disposed || paused || lost || running || document.hidden) return;
    running=true;last=performance.now();frame=requestAnimationFrame(draw);
  }
  function updateState(next) {
    state=next;
    const r=state.resources;
    for(const [id,view] of regionViews) {
      const unlocked=regionUnlocked(state,id);
      view.signalMaterial.color.copy(palette[unlocked?'accent':'text-muted']);
      view.signalMaterial.emissive.copy(palette[unlocked?'accent':'text-muted']);
      view.signalMaterial.emissiveIntensity=unlocked ? .6 : .06;
      view.growth.visible=r.access>=45 || (id==='commons'&&state.flags.includes('public-map'));
      view.growth.scale.y=.7+r.access/100;
      view.wayfinder.visible=Boolean(state.decisions.M00);
      if(id==='foundry') view.detail.scale.y=.85+r.output/200;
      if(id==='distribution') view.growth.visible=r.access>=40;
      if(id==='civic') view.marker.rotation.z=(100-r.control)/100*Math.PI/2;
      if(id==='frontier' && state.operations.M11) {
        const program=state.operations.M11.selection;
        view.programDisplay.visible=program!==3;
        view.programDisplay.scale.setScalar(program===1?1.25:program===2?.65:1);
        view.programDisplay.rotation.z=program===2?Math.PI/2:0;
      }
    }
    connections.forEach(connection=>{
      connection.line.visible=regionUnlocked(state,connection.a)&&regionUnlocked(state,connection.b);
      connection.line.scale.x=.1+state.resources.access/500;
    });
    if(paused&&!disposed&&!lost) renderer.render(scene,camera);
  }
  function previewOperation(regionId,payload) {
    const view=regionViews.get(regionId);
    if(!view) throw new Error('Cannot preview an unknown district.');
    const values=payload.routes || payload.units || payload.checks?.map(Boolean) || [payload.selection,0,0];
    view.taskLines.forEach((line,index)=>{
      const value=Number(values[index] || 0);
      line.rotation.y=value===0?Math.PI/3:0;
      line.scale.z=.15+Math.min(value,12)*.065;
    });
    view.marker.rotation.z=(Number(payload.selection)||0)*TAU/3;
    if(paused&&!disposed&&!lost) renderer.render(scene,camera);
  }
  function teleport(regionId) {
    const region=byId.get(regionId);
    if(!region || !regionUnlocked(state,regionId)) throw new Error('This district is not unlocked.');
    x=region.x;z=region.z+12;keys.clear();moveX=moveZ=0;yaw=0;
    avatar.position.set(x,.15,z);updateCamera();updateNearby();
    if(paused) renderer.render(scene,camera);
  }
  function themeChanged() {
    const next=themePalette();
    for(const key of Object.keys(palette)) palette[key].copy(next[key]);
    for(const [key,value] of materials) {
      const token=key.split(':')[0]; value.color.copy(palette[token]);value.emissive.copy(palette[token]);
    }
    scene.background.copy(palette.bg);scene.fog.color.copy(palette.bg);
    renderer.toneMappingExposure=document.documentElement.dataset.theme==='dark'?1.35:.9;
    lightColor.copy(palette.surface).lerp(palette.text,.5);
    lightColor.multiplyScalar(1/Math.max(.05,lightColor.r,lightColor.g,lightColor.b));
    ambient.color.copy(lightColor);ambient.groundColor.copy(palette['border-strong']);sun.color.copy(lightColor);
    updateState(state);
    if(paused) renderer.render(scene,camera);
  }
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0) return;
    drag={id:event.pointerId,x:event.clientX,y:event.clientY};
    canvas.setPointerCapture(event.pointerId);canvas.focus({preventScroll:true});
  },{signal:abort.signal});
  canvas.addEventListener('pointermove',event=>{
    if(!drag||drag.id!==event.pointerId||paused) return;
    yaw-=(event.clientX-drag.x)*.005;
    pitch=clamp(pitch+(event.clientY-drag.y)*.004,.18,1.12);
    drag.x=event.clientX;drag.y=event.clientY;
  },{signal:abort.signal});
  for(const type of ['pointerup','pointercancel']) canvas.addEventListener(type,()=>{drag=null;},{signal:abort.signal});
  canvas.addEventListener('wheel',event=>{
    if(paused) return;
    event.preventDefault();zoom=clamp(zoom+event.deltaY*.01,7,22);
  },{passive:false,signal:abort.signal});
  window.addEventListener('keydown',event=>{
    if(paused||event.altKey||event.ctrlKey||event.metaKey||
      event.target.closest('input,select,textarea,button,dialog,[contenteditable="true"]')) return;
    const key=event.key.toLowerCase();
    if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','q','e','shift'].includes(key)){
      event.preventDefault();keys.add(key);
    }
    if(key==='enter'&&nearest){event.preventDefault();onInteract(nearest);}
  },{signal:abort.signal});
  window.addEventListener('keyup',event=>keys.delete(event.key.toLowerCase()),{signal:abort.signal});
  window.addEventListener('blur',()=>{keys.clear();moveX=moveZ=0;drag=null;},{signal:abort.signal});
  canvas.addEventListener('webglcontextlost',event=>{
    event.preventDefault();lost=true;stop();onContextLost('The WebGL context was lost. Your decisions are retained; accessible travel and station controls still work.');
  },{signal:abort.signal});
  renderer.onDeviceLost=info=>{
    if(disposed) return;
    lost=true;stop();onContextLost(`${info.api} device/context lost: ${info.message}. Your decisions are retained.`);
  };

  resize();updateState(state);updateCamera();avatar.position.set(x,.15,z);updateNearby();start();
  return {
    teleport,updateState,previewOperation,themeChanged,
    setMoveInput(mx,mz){moveX=Number.isFinite(mx)?clamp(mx,-1,1):0;moveZ=Number.isFinite(mz)?clamp(mz,-1,1):0;},
    nudgeCamera(horizontal,vertical=0){yaw+=horizontal;pitch=clamp(pitch+vertical,.18,1.12);},
    setPaused(value){paused=Boolean(value);if(paused)stop();else start();},
    setReducedMotion(value){reducedMotion=Boolean(value);},
    getLocation(){return{x,z,yaw,pitch,zoom};},
    restoreLocation(location){
      if(!location||![location.x,location.z,location.yaw,location.pitch,location.zoom].every(Number.isFinite)||
        !isWalkable(location.x,location.z))throw new GameLocationError('Saved location is outside the navigable world.');
      x=location.x;z=location.z;yaw=location.yaw;pitch=clamp(location.pitch,.18,1.12);zoom=clamp(location.zoom,7,22);
      avatar.position.set(x,.15,z);updateCamera();updateNearby();
    },
    metrics(){
      const times=[...frameTimes].sort((a,b)=>a-b);
      return {revision:THREE.REVISION,backend:api,webgl2:api==='WebGL2',webgpu:api==='WebGPU',
        adapter:adapterInfo,adapterScope,fallbackReason,
        renderedFrames,drawCalls:renderer.info.render.drawCalls,triangles:renderer.info.render.triangles,
        geometries:geometries.size,materials:ownedMaterials.size,textures:renderer.info.memory.textures,
        quality,dpr:renderer.getPixelRatio(),pixels:canvas.width*canvas.height,
        frameP95:times.length?times[Math.floor((times.length-1)*.95)]:null,running,disposed,lost};
    },
    dispose(){
      if(disposed)return;
      disposed=true;stop();abort.abort();resizeObserver.disconnect();
      // Renderer/node caches can outlive a context; do not let them retain the campaign through callbacks.
      renderer.onDeviceLost=discardedCallback;
      onNear=onInteract=onContextLost=onMarkers=discardedCallback;
      geometries.forEach(value=>value.dispose());ownedMaterials.forEach(value=>value.dispose());
      const context=renderer.getContext();
      renderer.dispose();
      if(api==='WebGPU'){context.unconfigure();device?.destroy();}
      else context.getExtension('WEBGL_lose_context')?.loseContext();
      scene.clear();geometries.clear();ownedMaterials.clear();materials.clear();
    },
  };
}
