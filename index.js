
import * as THREE from 'three';

import { GUI } from 'three/addons/libs/lil-gui.module.min.js';

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

let container;
let camera, scene, renderer;
let ZMax, ZMin, ZRange;
const splineHelperObjects = [];
let splinePointsLength = 4;
const positions = [];
const point = new THREE.Vector3();

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const onUpPosition = new THREE.Vector2();
const onDownPosition = new THREE.Vector2();

const geometry = new THREE.BoxGeometry(20, 20, 20);
let transformControl;

const ARC_SEGMENTS = 500;

const splines = {};

const ip = {"uniform":false,"tension":0.5,"centripetal":false,"chordal":true,
"xfn":"0",
"yfn":"0",
"zfn":"0","addPoint": addPoint,"removePoint": removePoint,"exportSpline": exportSpline, "feedRate":1000, "exportGcode": exportGcode}

const machXmm = 320;  // 158
const machYmm = 280;  // 102
const machZmm = 200;  //  16

const width = machXmm * 10;
const height = machYmm * 10;
init();

function GridGeometry(width = 1, height = 1, wSeg = 1, hSeg = 1, tx = 0, ty = 0, lExt = [0, 0]) {
	let seg = new THREE.Vector2(width / wSeg, height / hSeg);
	let hlfSeg = seg.clone().multiplyScalar(0.5);

	let pts = [];

	for (let y = 0; y <= hSeg; y++) {
		pts.push(
			new THREE.Vector2(tx, y * seg.y + ty),
			new THREE.Vector2(width + tx + (hlfSeg.x * lExt[0]), y * seg.y + ty)
		)
	}

	for (let x = 0; x <= wSeg; x++) {
		pts.push(
			new THREE.Vector2(x * seg.x + tx, ty),
			new THREE.Vector2(x * seg.x + tx, height + ty + (hlfSeg.y * lExt[1]))
		)
	}
	return new THREE.BufferGeometry().setFromPoints(pts);
}

function init() {
	container = document.getElementById('container');
	scene = new THREE.Scene();
	scene.background = new THREE.Color(0xf0f0f0);

	//camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 1, 10000 );
	camera = new THREE.OrthographicCamera(width / - 2, width / 2, height / 2, height / - 2, -10000, 10000);
	camera.position.set(0, 0, 1000);
	scene.add(camera);
	scene.add(new THREE.AmbientLight(0xf0f0f0, 3));
	const light = new THREE.SpotLight(0xffffff, 4.5);
	light.position.set(0, 15000, 0);
	light.angle = Math.PI * 0.2;
	light.decay = 0;
	light.castShadow = true;
	light.shadow.camera.near = 1000;
	light.shadow.camera.far = 20000;
	light.shadow.bias = - 0.000222;
	light.shadow.mapSize.width = width;
	light.shadow.mapSize.height = height;
	scene.add(light);

	const planeGeometry = new THREE.PlaneGeometry(width * 2, height * 2);
	planeGeometry.rotateX(- Math.PI / 2);
	const planeMaterial = new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.2 });

	const plane = new THREE.Mesh(planeGeometry, planeMaterial);
	plane.position.y = - 200;
	plane.receiveShadow = true;
	scene.add(plane);

	// const helper = new THREE.GridHelper(width * 2, 20);
	// helper.position.y = - 199;
	// helper.material.opacity = 0.25;
	// helper.material.transparent = true;
	// scene.add(helper);
	const g2 = GridGeometry(width * 2, height * 2, width/200, height/200, -width, -height, [1, 1]);
	g2.rotateX(Math.PI * 0.5);
	//g2.translateX(-width)
	//g2.translateY(-height)
	let m2 = new THREE.LineBasicMaterial({ color: "gray" });
	let grid2 = new THREE.LineSegments(g2, m2);
	scene.add(grid2);

	renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.shadowMap.enabled = true;
	container.appendChild(renderer.domElement);

	const gui = new GUI();

	gui.add(ip, 'uniform').onChange(render);
	gui.add(ip, 'tension', 0, 1).step(0.01).onChange(function (value) {

		splines.uniform.tension = value;
		updateSplineOutline();
		render();

	});
	gui.add(ip, 'centripetal').onChange(render);
	gui.add(ip, 'chordal').onChange(render);
	gui.add(ip, 'addPoint');
	gui.add(ip, 'removePoint');
	gui.add(ip, 'exportSpline');
	gui.add(ip, 'feedRate', 500, 3000).step(100).onChange(function (value) {
		feedRate = value;
	});
	gui.add(ip, 'exportGcode');
	gui.add(ip, 'xfn').onChange(render);
	gui.add(ip, 'yfn').onChange(render);
	gui.add(ip, 'zfn').onChange(render);
	gui.open();

	// Controls
	const controls = new OrbitControls(camera, renderer.domElement);
	controls.damping = 0.2;
	controls.addEventListener('change', render);

	transformControl = new TransformControls(camera, renderer.domElement);
	transformControl.addEventListener('change', render);
	transformControl.addEventListener('dragging-changed', function (event) {

		controls.enabled = !event.value;

	});
	scene.add(transformControl);

	transformControl.addEventListener('objectChange', function () {

		updateSplineOutline();

	});

	document.addEventListener('pointerdown', onPointerDown);
	document.addEventListener('pointerup', onPointerUp);
	document.addEventListener('pointermove', onPointerMove);
	window.addEventListener('resize', onWindowResize);

	/*******
	 * Curves
	 *********/

	for (let i = 0; i < splinePointsLength; i++) {

		addSplineObject(positions[i]);

	}

	positions.length = 0;

	for (let i = 0; i < splinePointsLength; i++) {

		positions.push(splineHelperObjects[i].position);

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_SEGMENTS * 3), 3));

	let curve = new THREE.CatmullRomCurve3(positions);
	curve.curveType = 'catmullrom';
	curve.mesh = new THREE.Line(geometry.clone(), new THREE.LineBasicMaterial({
		color: 0xff0000,
		opacity: 0.35
	}));
	curve.mesh.castShadow = true;
	splines.uniform = curve;

	curve = new THREE.CatmullRomCurve3(positions);
	curve.curveType = 'centripetal';
	curve.mesh = new THREE.Line(geometry.clone(), new THREE.LineBasicMaterial({
		color: 0x00ff00,
		opacity: 0.35
	}));
	curve.mesh.castShadow = true;
	splines.centripetal = curve;

	curve = new THREE.CatmullRomCurve3(positions);
	curve.curveType = 'chordal';
	curve.mesh = new THREE.Line(geometry.clone(), new THREE.LineBasicMaterial({
		color: 0x0000ff,
		opacity: 0.35
	}));
	curve.mesh.castShadow = true;
	splines.chordal = curve;

	for (const k in splines) {
		const spline = splines[k];
		scene.add(spline.mesh);
	}

	load(
[new THREE.Vector3(1090.890665653639, 593.5759567192866, 2052.291441298524), new THREE.Vector3(659.5743958914084, -112.2139316827628, 1714.678308738237), new THREE.Vector3(-79.7164037556305, -145.0279633844146, 1721.6090487347124), new THREE.Vector3(-1020.9651203326828, -130.51153273940167, 2090.2759617232778), new THREE.Vector3(-1728.305870763728, -141.53215262916774, 930.3961039848248), new THREE.Vector3(-566.4455411662054, -153.49896622818835, 777.8178751999585), new THREE.Vector3(-940.4372711336629, -136.7269809952894, 1780.9810798256083), new THREE.Vector3(-1325.5341516278431, -146.60122155760916, 1125.2438538479125), new THREE.Vector3(-854.2075497308766, -151.01443016582266, 1026.5865870028729), new THREE.Vector3(-863.9615693433259, 277.9221166596704, 1382.2863964011246)]
        // [new THREE.Vector3(2624.581636315353, 593.5759567192866, 2052.291441298524), new THREE.Vector3(2313.7276346545223, -102.89612802219693, 1724.6090487347124), new THREE.Vector3(2222.963763035519, -103.09784691186873, 1721.6090487347124), new THREE.Vector3(-2356.9597621445578, -135.8873402105778, 424.3387771924762), new THREE.Vector3(2110.5571955679306, -130.25569540630806, -652.8119507380368), new THREE.Vector3(-2294.985699436298, -120.04847225947607, -1772.5544583532583), new THREE.Vector3(-2432.7569471644356, -118.38179104450577, -1762.5544583532583), new THREE.Vector3(-2592.8657308910288, 683.9992307836517, -2042.2056515417355)]
		// [new THREE.Vector3(837.2472948298409, 593.5759567192866, 691.7530285625204), new THREE.Vector3(1010.3806405430956, -187.01434124955085, 184.1999020252184), new THREE.Vector3(-960.9306600733564, -174.26362365780747, -81.51383732401013), new THREE.Vector3(1122.1827045362943, -182.63309969140843, -259.9542775336672), new THREE.Vector3(-1130.6020399047818, -47.191631548145295, -443.58296161811586), new THREE.Vector3(-1108.9904671694449, 683.9992307836517, -713.785931298165)]
		// [new THREE.Vector3(1071.0466413688443, 593.5759567192866, 131.03290006234533), new THREE.Vector3(1029.1777650125384, -87.0096731561909, 232.746502652775), new THREE.Vector3(320.3148022519208, -82.38861335173613, 125.54731815816785), new THREE.Vector3(115.13416460641807, -62.32342595664549, -454.8187768525749), new THREE.Vector3(-664.9070138980061, -75.62926140407853, -78.26205087742642), new THREE.Vector3(-901.4615805815979, 590.8108341689484, -243.14638955173552)]
		//[new THREE.Vector3(255.7472271021835, 593.5759567192866, -111.88488858816189), new THREE.Vector3(1029.1777650125384, -87.0096731561909, 232.746502652775), new THREE.Vector3(320.3148022519208, -82.38861335173613, 125.54731815816785), new THREE.Vector3(115.13416460641807, -62.32342595664549, -454.8187768525749), new THREE.Vector3(-664.9070138980061, -75.62926140407853, -78.26205087742642), new THREE.Vector3(246.91175663978728, 595.1632436560665, -102.12713818251699)]
	);

	render();

}

function addSplineObject(position) {

	const material = new THREE.MeshLambertMaterial({ color: Math.random() * 0xffffff });
	const object = new THREE.Mesh(geometry, material);

	if (position) {

		object.position.copy(position);

	} else {

		object.position.x = Math.random() * width - (width / 2);
		object.position.y = Math.random() * 600;
		object.position.z = Math.random() * height - (height / 2);

	}

	object.castShadow = true;
	object.receiveShadow = true;
	scene.add(object);
	splineHelperObjects.push(object);
	return object;

}

function addPoint() {

	splinePointsLength++;

	positions.push(addSplineObject().position);

	updateSplineOutline();

	render();

}

function removePoint() {

	if (splinePointsLength <= 4) {

		return;

	}

	const point = splineHelperObjects.pop();
	splinePointsLength--;
	positions.pop();

	if (transformControl.object === point) transformControl.detach();
	scene.remove(point);

	updateSplineOutline();

	render();

}

// function ev(codeStr, env) {
// 	const s = Math.sin
// 	const c = Math.cos
// 	const t = env.t
// 	const PI = Math.PI
// 	return eval(codeStr)
// }

function updateSplineOutline() {
	for (const k in splines) {

		const spline = splines[k];

		const splineMesh = spline.mesh;
		const position = splineMesh.geometry.attributes.position;

		let brushRotation = 0;//Math.PI / 4
		const brushAngle = -Math.PI / 4; // from vertical
		const brushLengthMm = 80;
		const brushOffset = new THREE.Vector3(0, 0, 0);
		const prev = new THREE.Vector3();
		spline.getPoint(0.0, prev);


		for (let i = 1; i < ARC_SEGMENTS; i+=3) {

			const t = i / ARC_SEGMENTS;

			spline.getPoint(t, point);

			brushRotation = angle(new THREE.Vector3().subVectors(point, prev).normalize());
			setBrushOffset(brushOffset, brushRotation, brushAngle, brushLengthMm*10);

			const offsetPoint = new THREE.Vector3().addVectors(point, brushOffset);
			position.setXYZ(i, point.x, point.y, point.z);
			position.setXYZ(i+1, offsetPoint.x, offsetPoint.y, offsetPoint.z);
			position.setXYZ(i+2, point.x, point.y, point.z);
			prev.x = point.x;
			prev.y = point.y;
			prev.z = point.z;
		}
		position.needsUpdate = true;
	}

}

function toStringSpline() {
	const strplace = [];
	for (let i = 0; i < splinePointsLength; i++) {
		const p = splineHelperObjects[i].position;
		strplace.push(`new THREE.Vector3(${p.x}, ${p.y}, ${p.z})`);
	}
	// console.log(strplace.join(',\n'));
	return '[' + (strplace.join(', ')) + ']';

}

var feedRate = 1000;

function exportSpline() {
	const data = toStringSpline()

	// 2. Create a Blob for a JSON file
	const blob = new Blob([data], { type: 'text/javascript' });

	// 3. Create a URL
	const url = URL.createObjectURL(blob);

	// 4. Create a Download Link
	const a = document.createElement('a');
	a.href = url;
	a.download = 'spline3d.js'; // Specify the name of the file

	// 5. Trigger the Download
	document.body.appendChild(a);
	a.click();

	// Cleanup
	document.body.removeChild(a);
	URL.revokeObjectURL(url); // Free up memory

}
function initZRange(spline) {
	ZMax = -100000.0
	ZMin = 100000.0
	for (let i = 1; i < ARC_SEGMENTS; i++) {
		const t = i / ARC_SEGMENTS;
		spline.getPoint(t, point);
		if (point.z > ZMax) {
			ZMax = point.z
		}
		if (point.z < ZMin) {
			ZMin = point.z
		}
	}
	ZRange = ZMax - ZMin 
}

// Exponentially compress the bottom of the z range (under construction emoji here)
function zExpAdjust(z_orig) {
	//const z_norm = -(z_orig-ZMin) / ZRange
	//const z_exp_norm = z_norm * z_norm
	//const z_adjusted = -z_exp_norm * ZRange + ZMin
	//return z_adjusted;
	return z_orig
}

function inMachineCoords(p) {
	const x = Math.max(0, Math.min(machXmm, (p.x + width) / 20.0));
	const y = Math.max(0, Math.min(machYmm, (p.z + 1000.0) / 20.0));
	const z = zExpAdjust(Math.max(0, Math.min(machZmm, (p.y + height) / 20 - 100.0)));
	return [x, y, z];
}

let last_br_deg = null;
let offset_br_deg = 0;
function brushMachineRotation(brushRotationRad) {
	
	let br_deg = brushRotationRad * 57.29578
	// bp_deg will range from -180 to 180 degrees

	console.log(br_deg)
	if (last_br_deg === null) {
		last_br_deg = br_deg
	}
	const dif = last_br_deg - br_deg
	if (Math.abs(dif) > 200) {
		if (dif > 0) {
			offset_br_deg += 360
		}
		else {
			offset_br_deg -= 360
		}
	}
	last_br_deg = br_deg
	return br_deg + offset_br_deg
}

function exportGcode() {
	const gCodeLines = [
		`; ${JSON.stringify(ip).slice(0, -1)},"addPoint": addPoint,"removePoint": removePoint,"exportSpline": exportSpline,"feedRate": feedRate,"exportGcode": exportGcode}`,
		`; ${toStringSpline()}`,
		'G21', 'G90', // millimeter and absolute coords
		';; Begin dip-tap',
		';G0 Z0 F100 ; Move up',
		';G0 X10 Y10 F200 ; Move to X10 Y10',
		';G01 Z4 F400 ; dip',
		';G01 Z2',
		';G01 Z4',
		';G01 Z2',
		';G01 X15',
		';G01 X10',
		';G01 X15',
		';G0 Z0',
		';; End dip-tap ',
		'; YZ adjustments',
		';#<y1>=100 #<y2>=0',
		';#<z1>=100 #<z2>=125',
		'G0 Y100 Z100',
		'G92 Y100 Z125',
		'; Begin stroke',
	];
	let brushRotation = 0;//Math.PI / 4
	let prevBrushHandle = new THREE.Vector3(0, 0, 0);
	let prev_br_deg = 0
	let rotation_deg = 0
	const zSafe = 200;
	const brushAngle = Math.PI / 4; // from vertical
	const brushLengthMm = 80;
	const brushOffset = new THREE.Vector3(0, 0, 0);
	const spline = splines['chordal'];
	const splineMesh = spline.mesh;
	const prev = new THREE.Vector3();
	spline.getPoint(0.0, prev);
	initZRange(spline);
	const [x0, y0, z0] = inMachineCoords(prev);
	gCodeLines.push(`G0 Z${zSafe.toFixed(1)}`);
	gCodeLines.push(`G0 X${x0.toFixed(2)} Y${y0.toFixed(2)}`);
	gCodeLines.push(`G0 Z${z0.toFixed(2)}`);
	for (let i = 1; i < ARC_SEGMENTS; i++) {
		const t = i / ARC_SEGMENTS;
		spline.getPoint(t, point);
		const pt = new THREE.Vector3();
		pt.x = point.x
		pt.y = point.y
		pt.z = point.z
		const pv = new THREE.Vector3();
		pv.x = prev.x
		pv.y = prev.y
		pv.z = prev.z
		prev_br_deg = rotation_deg
		brushRotation = angle(new THREE.Vector3().subVectors(pt, pv).normalize());
		setBrushOffset(brushOffset, brushRotation, brushAngle, brushLengthMm*10);
		// point.x += ev(ip.xfn, { t })
		// point.y += ev(ip.yfn, { t })
		// point.z += ev(ip.zfn, { t })
		const [x, y, z] = inMachineCoords(pt.add(brushOffset));
		// rate calc in MachineCoords 
		rotation_deg = brushMachineRotation(brushRotation)
		const feedRateMmPerMinute = Math.max(10, Math.min(prevBrushHandle.distanceTo(new THREE.Vector3(x, y, z)) * 3000, 10000))+ (Math.abs(prev_br_deg - rotation_deg))*100;

		gCodeLines.push(`G1 X${x.toFixed(2)} Y${y.toFixed(2)} Z${z.toFixed(2)} A${rotation_deg.toFixed(2)} F${feedRateMmPerMinute.toFixed(0)}`);

		prev.x = point.x
		prev.y = point.y
		prev.z = point.z
		prevBrushHandle.x = x
		prevBrushHandle.y = y
		prevBrushHandle.z = z
	}
	gCodeLines.push(`G0 Z${zSafe.toFixed(4)}`);
	gCodeLines.push('; YZ re-adjustments')
	gCodeLines.push('G0  Y100 Z125')
	gCodeLines.push('G92 Y100 Z100')
		
	gCodeLines.push('G0 X0', '; End stroke ')
	
	// download the gcode as a file

	// 1. Create the data
	const data = gCodeLines.join('\n');

	// 2. Create a Blob
	const blob = new Blob([data], { type: 'text/plain' });

	// 3. Create a URL
	const url = URL.createObjectURL(blob);

	// 4. Create a Download Link
	const a = document.createElement('a');
	a.href = url;
	a.download = 'spline3d.gcode'; // Specify the name of the file

	// 5. Trigger the Download
	document.body.appendChild(a);
	a.click();

	// Cleanup
	document.body.removeChild(a);
	URL.revokeObjectURL(url); // Free up memory
}

function angle(dir) {
	// const normal = new THREE.Vector3(-dir.z, 0, dir.x);
	// const binormal = new THREE.Vector3().crossVectors(dir, normal);
	// return Math.atan2(binormal.y, normal.y)
	return Math.atan2(dir.z, dir.x);
}
/*
const dir = new THREE.Vector3().subVectors(point, prev);
	const length = dir.length();
	dir.normalize();
	const normal = new THREE.Vector3(-dir.z, 0, dir.x);
	const binormal = new THREE.Vector3().crossVectors(dir, normal);
	const angle = Math.atan2(binormal.y, normal.y)
*/
function setBrushOffset(brushOffset, brushRotation, brushAngle, brushLengthMm) {
	brushOffset.x = Math.cos(brushRotation) * Math.sin(brushAngle) * brushLengthMm;
	brushOffset.z = Math.sin(brushRotation) * Math.sin(brushAngle) * brushLengthMm;
	brushOffset.y = Math.cos(brushAngle) * brushLengthMm;
}

function load(new_positions) {

	while (new_positions.length > positions.length) {

		addPoint();

	}

	while (new_positions.length < positions.length) {

		removePoint();

	}

	for (let i = 0; i < positions.length; i++) {

		positions[i].copy(new_positions[i]);

	}

	updateSplineOutline();

}

function render() {

	splines.uniform.mesh.visible = ip.uniform;
	splines.centripetal.mesh.visible = ip.centripetal;
	splines.chordal.mesh.visible = ip.chordal;
	renderer.render(scene, camera);

}

function onPointerDown(event) {

	onDownPosition.x = event.clientX;
	onDownPosition.y = event.clientY;

}

function onPointerUp(event) {

	onUpPosition.x = event.clientX;
	onUpPosition.y = event.clientY;

	if (onDownPosition.distanceTo(onUpPosition) === 0) {

		transformControl.detach();
		render();

	}

}

function onPointerMove(event) {

	pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
	pointer.y = - (event.clientY / window.innerHeight) * 2 + 1;

	raycaster.setFromCamera(pointer, camera);

	const intersects = raycaster.intersectObjects(splineHelperObjects, false);

	if (intersects.length > 0) {

		const object = intersects[0].object;

		if (object !== transformControl.object) {

			transformControl.attach(object);

		}

	}

}

function onWindowResize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize(window.innerWidth, window.innerHeight);

	render();

}
