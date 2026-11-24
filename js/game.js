/* ============================================================================
 * game.js — Cœur du jeu : boucle, joueur, survie, progression, interactions,
 * léviathan, missions, découvertes, sauvegarde et chargement.
 * ==========================================================================*/
window.PP = window.PP || {};

PP.Game = (function () {
    'use strict';

    const D = PP.Data;
    const U = D.UTILS;
    const W = D.WORLD;
    const SAVE_KEY = 'pelagic_thalassa_save_v4';
    const SAVE_BACKUP_KEY = SAVE_KEY + '_backup';
    const SAVE_VERSION = 4;
    const SETTINGS_KEY = 'pelagic_thalassa_settings_v3';

    const canvas = document.getElementById('game-canvas');
    let scene, camera, renderer, clock;
    let composer, bloomPass, gradePass, lastSceneRender;
    let world, factory;
    let hemi, dir, rim, ambient, headlamp, accentLight;
    let waypointGroup, wpBeacon;
    let sonarMesh, sonarMat;
    let laserLine, arcLine;
    let raycaster;
    let elapsed = 0;
    let menuAngle = 0;
    let hudAccumulator = 0;
    let missionAccumulator = 0;
    let discoveryAccumulator = 0;
    let achievementAccumulator = 0;
    let autosaveAccumulator = 0;
    let interactables = [];
    let terrainMeshes = [];
    let hoveredEntity = null;
    let placementData = null;
    let mineCooldown = 0;
    let arcCooldown = 0;
    let arcTimer = 0;
    let miningBeamTimer = 0;
    let diveTimer = null;
    let lastRegionId = null;
    let lastLevel = 1;
    let menuFeedbackTimer = 0;
    let starting = false;
    let relicPinged = {};

    const state = {
        isPlaying: false, isPaused: false, gameWon: false, pointerLocked: false,
        started: false, loadedSave: false,
        inventory: { ...D.START_INVENTORY },
        unlockedTechs: {},
        completedMain: [], completedSide: [],
        codex: {}, achievements: {},
        visitedRegions: {}, discoveredPois: {}, discoveredNodes: [],
        relics: {}, contracts: [], nextContractId: 1,
        relicBuffs: { speed: 0, o2: 0, hull: 0, power: 0, scan: 0, xeno: 0, stealth: 0, light: 0, craft: 0, drill: 0 },
        credits: 140, difficulty: 'engineer', marketSeed: 1,
        mapMarkers: [], regionCells: {}, masteryClaims: {}, cacheTaken: {},
        surgeTimer: 0, surgeCooldown: 0, silenceTimer: 0, silenceCooldown: 0,
        ascentCooldown: 0, autoScan: false, autoScanTimer: 0,
        breach: { active: false, timer: 0 },
        photoFilter: 0, lastBuildType: null, currentInfo: { x: 0, z: 0, speed: 0 },
        hullResist: 0, stealthFactor: 1, moveSpeed: 24,
        photoMode: false, depthHold: false, heldDepth: 0,
        emergencyO2Used: false, fieldRepairCooldown: 0, recallCooldown: 0,
        scanCooldown: 0, nodeHighlight: false, depthMilestones: {},
        stats: {
            mined: 0, buildCount: 0, playTime: 0, maxDepth: 0, sonarUses: 0,
            crafted: 0, xenoMined: 0, weaverRepels: 0, regionsFound: 0,
            poiFound: 0, distance: 0, won: 0, xenoCoreMade: 0, habitats: 0,
            ventThermals: 0, relicsFound: 0, contractsDone: 0
        },
        xp: 0,
        settings: { ...D.DEFAULT_SETTINGS },
        maxO2: 100, o2: 100, hull: 100, maxCrushDepth: 320,
        acousticStealth: false,
        powerProduced: 0, powerConsumed: 0, powerEfficiency: 1, powerReserve: 0, powerWarning: false,
        buildings: [], pipes: [], drones: [],
        nextBuildingId: 2,
        waypoint: null,
        selectedTool: 0, currentBuild: null, buildRotation: 0, pipeSource: null,
        gridSnap: false, sonarCooldown: 0, tethered: false,
        mouseDown: false,
        placementValid: false,
        resumeCamera: null,
        currentRegionId: 'kelp',
        activeMainMission: null
    };

    /* ------------------------------------------------------------------ */
    /* INITIALISATION                                                      */
    /* ------------------------------------------------------------------ */
    function readSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    Object.keys(D.DEFAULT_SETTINGS).forEach(key => {
                        if (parsed[key] !== undefined) state.settings[key] = parsed[key];
                    });
                }
            }
        } catch (error) { /* stockage indisponible */ }
        state.settings.quality = D.QUALITY_PRESETS[state.settings.quality] ? state.settings.quality : 'high';
    }

    function qualityPreset() {
        return { ...D.QUALITY_PRESETS[state.settings.quality], quality: state.settings.quality };
    }

    const DIFFICULTIES = {
        explorer: { name: 'Explorateur', o2: 0.78, damage: 0.68, yield: 0.0, xp: 1.0, credits: 1.0, desc: 'O₂ généreux, coque renforcée. Pour découvrir l\'histoire.' },
        engineer: { name: 'Ingénieur', o2: 1.0, damage: 1.0, yield: 0.06, xp: 1.0, credits: 1.0, desc: 'Équilibre nominal de la sonde. L\'expérience de référence.' },
        abyssal: { name: 'Abyssal', o2: 1.22, damage: 1.4, yield: 0.28, xp: 1.3, credits: 1.35, desc: 'Pression hostile, rendements accrus. Pour les vétérans.' }
    };
    function difficultyProfile() { return DIFFICULTIES[state.difficulty] || DIFFICULTIES.engineer; }

    function setDifficulty(id) {
        if (!DIFFICULTIES[id]) return false;
        state.difficulty = id;
        toast(`Profil de mission : ${DIFFICULTIES[id].name}. ${DIFFICULTIES[id].desc}`, 'info', 'PROFIL');
        saveGame(false);
        updateHUDNow();
        return true;
    }

    function setupScene() {
        renderer = new THREE.WebGLRenderer({
            canvas, antialias: true, powerPreference: 'high-performance', alpha: false
        });
        const preset = qualityPreset();
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = !!preset.shadows;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        renderer.outputEncoding = THREE.sRGBEncoding;

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x042838);
        scene.fog = new THREE.FogExp2(0x042838, 0.0018);

        camera = new THREE.PerspectiveCamera(state.settings.fov || 72, window.innerWidth / window.innerHeight, 0.12, 9000);
        camera.position.set(0, 12, 36);

        hemi = new THREE.HemisphereLight(0x7dd3fc, 0x04121f, 1.05);
        scene.add(hemi);
        ambient = new THREE.AmbientLight(0x0b2231, 0.38);
        scene.add(ambient);

        dir = new THREE.DirectionalLight(0x9fe8ff, 1.25);
        dir.position.set(260, 540, 210);
        dir.castShadow = !!preset.shadows;
        const shadowRes = state.settings.quality === 'ultra' ? 2048 : 1536;
        dir.shadow.mapSize.width = shadowRes;
        dir.shadow.mapSize.height = shadowRes;
        dir.shadow.camera.near = 1;
        dir.shadow.camera.far = 1200;
        dir.shadow.camera.left = -180;
        dir.shadow.camera.right = 180;
        dir.shadow.camera.top = 180;
        dir.shadow.camera.bottom = -180;
        dir.shadow.bias = -0.0012;
        scene.add(dir);
        scene.add(dir.target);

        // Contre-jour discret : détache les silhouettes de la flore du fond
        // sans ajouter une seconde source dominante.
        rim = new THREE.DirectionalLight(0x67e8f9, 0.35);
        rim.position.set(-260, 180, -320);
        scene.add(rim);
        scene.add(rim.target);

        headlamp = new THREE.PointLight(0xfff3d6, 0.8, 46, 2);
        scene.add(headlamp);
        // Fill bioluminescent : éclaire la matière proche sans transformer
        // les abysses en plein jour. Sa teinte suit l'accent de la région.
        accentLight = new THREE.PointLight(0x22d3ee, 0, 58, 2);
        scene.add(accentLight);

        clock = new THREE.Clock();
        raycaster = new THREE.Raycaster();
        raycaster.far = 55;

        createHelpers();
        window.addEventListener('resize', onResize);
        bindControls();
    }

    /* ------------------------------------------------------------------ */
    /* POST-TRAITEMENT                                                     */
    /* ------------------------------------------------------------------ */
    /* Étalonnage final : vignettage, grain, aberration chromatique et
       correction de contraste. C'est ce qui distingue une scène « rendue »
       d'une image de synthèse brute, sans coûter une seconde passe 3D. */
    const GradeShader = {
        uniforms: {
            tDiffuse: { value: null },
            uTime: { value: 0 },
            uVignette: { value: 0.14 },
            uGrain: { value: 0.022 },
            uAberration: { value: 0.0009 },
            uSaturation: { value: 1.08 },
            uContrast: { value: 1.05 },
            uDamage: { value: 0 }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform float uTime;
            uniform float uVignette;
            uniform float uGrain;
            uniform float uAberration;
            uniform float uSaturation;
            uniform float uContrast;
            uniform float uDamage;
            varying vec2 vUv;

            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
            }

            void main() {
                vec2 centered = vUv - 0.5;
                float r2 = dot(centered, centered);
                // L'aberration ne se voit qu'en périphérie : c'est une lentille,
                // pas un filtre coloré sur toute l'image.
                float ab = uAberration * (0.35 + r2 * 2.6);
                vec3 col;
                col.r = texture2D(tDiffuse, vUv + centered * ab).r;
                col.g = texture2D(tDiffuse, vUv).g;
                col.b = texture2D(tDiffuse, vUv - centered * ab).b;

                col = (col - 0.5) * uContrast + 0.5;
                float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
                col = mix(vec3(luma), col, uSaturation);

                float vig = smoothstep(0.28, 0.88, length(centered));
                col *= 1.0 - vig * uVignette;

                // Grain animé, plus lisible dans les ombres que dans les hautes
                // lumières : il donne de la matière au bleu profond.
                float n = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 71.0) - 0.5;
                col += n * uGrain * (0.45 + (1.0 - luma) * 0.85);

                // Voile rouge à la périphérie quand la coque cède.
                col = mix(col, vec3(0.30, 0.015, 0.04), uDamage * vig * 0.32);

                gl_FragColor = vec4(col, 1.0);
            }
        `
    };

    function disposeComposer() {
        if (composer) {
            try {
                composer.renderTarget1.dispose();
                composer.renderTarget2.dispose();
                composer.passes.forEach(pass => { if (pass.dispose) pass.dispose(); });
            } catch (error) { /* cibles déjà libérées */ }
        }
        composer = null;
        bloomPass = null;
        gradePass = null;
        lastSceneRender = null;
    }

    function setupComposer() {
        if (!renderer || !scene || !camera) return;
        if (!THREE.EffectComposer || !THREE.RenderPass || !THREE.UnrealBloomPass) return;
        disposeComposer();
        try {
            composer = new THREE.EffectComposer(renderer);
            const scenePass = new THREE.RenderPass(scene, camera);
            const baseRender = scenePass.render.bind(scenePass);
            scenePass.render = function (...args) {
                baseRender(...args);
                const info = renderer.info.render;
                lastSceneRender = {
                    calls: info.calls, triangles: info.triangles,
                    lines: info.lines, points: info.points
                };
            };
            composer.addPass(scenePass);
            bloomPass = new THREE.UnrealBloomPass(
                new THREE.Vector2(window.innerWidth, window.innerHeight),
                0.23, 0.55, 0.79
            );
            // Le scene pass est déjà tonemappé : la copie de présentation ne
            // doit pas lui appliquer ACES une seconde fois.
            if (bloomPass.basic) bloomPass.basic.toneMapped = false;
            if (bloomPass.materialCopy) bloomPass.materialCopy.toneMapped = false;
            composer.addPass(bloomPass);
            if (THREE.ShaderPass) {
                gradePass = new THREE.ShaderPass(GradeShader);
                composer.addPass(gradePass);
            }
            composer.setPixelRatio(renderer.getPixelRatio());
            composer.setSize(window.innerWidth, window.innerHeight);
        } catch (error) {
            console.warn('Bloom indisponible, rendu direct.', error);
            disposeComposer();
        }
    }

    function createHelpers() {
        waypointGroup = new THREE.Group();
        const pillar = new THREE.Mesh(
            new THREE.CylinderGeometry(0.28, 0.28, 90, 8, 1, true),
            new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false })
        );
        pillar.position.y = 45;
        waypointGroup.add(pillar);
        wpBeacon = new THREE.Mesh(new THREE.OctahedronGeometry(1.6, 0), new THREE.MeshBasicMaterial({ color: 0xfde047 }));
        wpBeacon.position.y = 8;
        waypointGroup.add(wpBeacon);
        waypointGroup.visible = false;
        scene.add(waypointGroup);

        const ringGeo = new THREE.RingGeometry(0.92, 1.35, 64);
        ringGeo.rotateX(-Math.PI / 2);
        sonarMat = new THREE.MeshBasicMaterial({
            color: 0x22d3ee, transparent: true, opacity: 0, side: THREE.DoubleSide,
            depthWrite: false, blending: THREE.AdditiveBlending
        });
        sonarMesh = new THREE.Mesh(ringGeo, sonarMat);
        sonarMesh.visible = false;
        scene.add(sonarMesh);

        const laserGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        laserLine = new THREE.Line(laserGeo, new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9 }));
        laserLine.visible = false;
        scene.add(laserLine);

        const arcGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        arcLine = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0 }));
        arcLine.visible = false;
        scene.add(arcLine);
    }

    /* ------------------------------------------------------------------ */
    /* BOUCLE PRINCIPALE                                                   */
    /* ------------------------------------------------------------------ */
    function animate() {
        requestAnimationFrame(animate);
        const dt = Math.min(clock.getDelta(), 0.08);
        elapsed += dt;

        const modalOpen = PP.UI && PP.UI.anyModalOpen ? PP.UI.anyModalOpen() : false;
        const simActive = state.isPlaying && !state.isPaused && !modalOpen;

        if (!state.isPlaying) {
            menuCamera(dt);
        }

        if (simActive) {
            updatePlayer(dt);
            updateInteract();
            updateSurvival(dt);
            updateOps(dt);
            updateWeaver(dt);
            factory.update(dt);
            updateDiscovery(dt);
            updateMissions(dt);
            updateAchievements(dt);

            state.stats.playTime += dt;
            autosaveAccumulator += dt;
            if (autosaveAccumulator > 45) {
                autosaveAccumulator = 0;
                saveGame(false);
            }
        } else if (state.isPlaying) {
            clearPressedKeys();
            if (laserLine) laserLine.visible = false;
        }

        if (state.isPlaying) {
            hudAccumulator += dt;
            if (hudAccumulator > 0.1) {
                hudAccumulator = 0;
                PP.UI.updateHUD();
            }
        }

        updateSceneMood(dt);
        if (world) world.update(dt, camera, elapsed);
        updateVisuals(dt);
        updateAudio(dt);

        if (headlamp) headlamp.position.copy(camera.position);
        if (wpBeacon) {
            wpBeacon.rotation.y += dt * 1.8;
            wpBeacon.position.y = 8 + Math.sin(elapsed * 1.4) * 1.2;
        }

        if (composer) composer.render();
        else renderer.render(scene, camera);
    }

    function menuCamera(dt) {
        // Orbite sous la surface, cadrée sur la capsule et la canopée de kelp.
        menuAngle += dt * 0.055;
        const radius = 58;
        const x = Math.cos(menuAngle) * radius;
        const z = Math.sin(menuAngle) * radius;
        const y = 9.6 + Math.sin(menuAngle * 1.7) * 2.2;
        camera.position.lerp(new THREE.Vector3(x, y, z), Math.min(1, dt * 1.2));
        camera.lookAt(0, 7.2, 0);
        camera.rotation.z = Math.sin(menuAngle * 0.8) * 0.012;
        if (headlamp) {
            headlamp.position.copy(camera.position);
            headlamp.intensity = 1.15;
        }
    }

    function onResize() {
        if (!renderer) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        if (composer) {
            composer.setPixelRatio(renderer.getPixelRatio());
            composer.setSize(window.innerWidth, window.innerHeight);
        }
    }

    /* ------------------------------------------------------------------ */
    /* MOUVEMENT & SURVIE                                                  */
    /* ------------------------------------------------------------------ */
    const keys = {};
    const velocity = new THREE.Vector3();
    const lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    let isDraggingLook = false;
    let lastMouseX = 0, lastMouseY = 0;

    function clearPressedKeys() {
        Object.keys(keys).forEach(k => { keys[k] = false; });
        state.mouseDown = false;
        velocity.multiplyScalar(0.2);
    }

    function updatePlayer(dt) {
        const move = new THREE.Vector3();
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        if (keys['KeyW'] || keys['KeyZ'] || keys['ArrowUp']) move.add(forward);
        if (keys['KeyS'] || keys['ArrowDown']) move.sub(forward);
        if (keys['KeyD'] || keys['ArrowRight']) move.add(right);
        if (keys['KeyA'] || keys['KeyQ'] || keys['ArrowLeft']) move.sub(right);
        if (keys['Space']) move.y += 1;
        if (keys['ShiftLeft'] || keys['ShiftRight']) move.y -= 1;

        const tethered = state.tethered;
        let speed = state.moveSpeed || 24;
        if (tethered) speed *= 0.16;
        if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
        velocity.lerp(move, Math.min(1, dt * 4.2));
        camera.position.addScaledVector(velocity, dt);

        // Courants marins : dérive lente, plus marquée en profondeur.
        const current = currentAt(camera.position.x, camera.position.z);
        state.currentInfo = { x: current.x, z: current.z, speed: current.speed };
        if (!state.depthHold) {
            camera.position.x += current.x * dt * 0.55;
            camera.position.z += current.z * dt * 0.55;
        }

        // Pilote de profondeur : maintient l'altitude sans annuler le regard.
        if (state.depthHold && !keys['Space'] && !keys['ShiftLeft'] && !keys['ShiftRight']) {
            const targetY = W.WATER_Y - state.heldDepth / W.DEPTH_SCALE;
            camera.position.y += (targetY - camera.position.y) * Math.min(1, dt * 2.4);
            velocity.y *= 0.82;
        }

        const ground = world.height(camera.position.x, camera.position.z) + 1.85;
        if (camera.position.y < ground) {
            camera.position.y = ground;
            if (velocity.y < 0) velocity.y = 0;
        }
        if (camera.position.y > W.WATER_Y - 2.4) {
            camera.position.y = W.WATER_Y - 2.4;
            if (velocity.y > 0) velocity.y = 0;
        }
        camera.position.x = U.clamp(camera.position.x, -W.HALF + 18, W.HALF - 18);
        camera.position.z = U.clamp(camera.position.z, -W.HALF + 18, W.HALF - 18);

        if (velocity.lengthSq() > 0.05) {
            state.stats.distance += velocity.length() * dt;
            camera.position.y += Math.sin(elapsed * 7) * 0.0018 * Math.min(1, velocity.length() / 12);
        }

        // Ambiance locale et profondeur
        const depth = world.depthOf(camera.position.y);
        if (depth > state.stats.maxDepth) {
            const previous = state.stats.maxDepth;
            state.stats.maxDepth = depth;
            [500, 1000, 1500, 2000, 2500].forEach(milestone => {
                if (previous < milestone && depth >= milestone) {
                    toast(`Nouveau record de profondeur : ${milestone} m. La sonde tient bon.`, 'success', 'PROFONDEUR');
                    addXp(40);
                }
            });
        }

        const region = world.regionAt(camera.position.x, camera.position.z);
        state.currentRegionId = region.id;

        // O2 et réparation
        const nearPod = state.buildings.some(b => (b.type === 'hub' || b.type === 'habitat') && camera.position.distanceTo(b.position) < dockRadius(b));
        if (nearPod) {
            state.o2 = Math.min(state.maxO2, state.o2 + dt * 24);
            state.hull = Math.min(100, state.hull + dt * 8);
            state.emergencyO2Used = false;
        } else {
            state.o2 -= dt * (state.unlockedTechs.o2Mk1 ? 0.92 : 1) * difficultyProfile().o2;
        }

        const over = depth - state.maxCrushDepth;
        if (over > 0) {
            state.hull -= dt * (3.5 + Math.min(25, over * 0.035)) * (1 - state.hullResist) * difficultyProfile().damage;
            const overlay = document.getElementById('damage-overlay');
            if (overlay) overlay.style.opacity = String(U.clamp(over / 300, 0.15, 0.7));
            if (Math.random() < dt * 0.35) PP.Audio.hull();
        } else {
            const overlay = document.getElementById('damage-overlay');
            if (overlay) overlay.style.opacity = String(Math.max(0, parseFloat(overlay.style.opacity || '0') - dt * 2));
        }

        if (state.o2 <= 0 || state.hull <= 0) emergencyRecall();

        const tetherEl = document.getElementById('tether-warning');
        if (tetherEl) tetherEl.classList.toggle('show', state.tethered);
    }

    function emergencyRecall() {
        // Le sauvetage automatique n'est pas une téléportation gratuite :
        // une partie du fret brut est perdue et la capsule revient en état
        // dégradé. Le joueur conserve sa progression, pas son butin complet.
        let lost = 0;
        D.RESOURCE_ORDER.forEach(key => {
            const info = D.RESOURCES[key];
            if (!info || info.tier !== 'raw') return;
            const qty = Math.floor((state.inventory[key] || 0) * 0.25);
            if (qty > 0) {
                state.inventory[key] = Math.max(0, (state.inventory[key] || 0) - qty);
                lost += qty;
            }
        });
        state.o2 = Math.min(state.maxO2, Math.max(45, Math.round(state.maxO2 * 0.55)));
        state.hull = 65;
        state.tethered = false;
        state.depthHold = false;
        if (state.breach) state.breach.active = false;
        if (world.weaver) world.weaver.tethered = false;
        if (world.silkLine) world.silkLine.visible = false;
        document.getElementById('tether-warning').classList.remove('show');
        document.getElementById('damage-overlay').style.opacity = '0';
        const hub = state.buildings.find(b => b.type === 'hub');
        const base = hub ? hub.position : new THREE.Vector3(0, 7, 0);
        camera.position.set(base.x + 4, base.y + 7, base.z + 14);
        camera.lookAt(base.x, base.y + 4, base.z);
        lookEuler.setFromQuaternion(camera.quaternion);
        velocity.set(0, 0, 0);
        PP.Audio.alarm();
        toast(`Rupture critique : rapatriement d'urgence. Coque à 65 %, O₂ de secours. ${lost > 0 ? `${lost} unités de fret brut perdues.` : 'Fret brut déjà vide.'}`, 'danger', 'SURVIE');
        saveGame(false);
    }

    /* ------------------------------------------------------------------ */
    /* PROTOCOLES DE TERRAIN Mk.IV                                        */
    /* ------------------------------------------------------------------ */
    function hubAnchor() {
        const hub = state.buildings.find(b => b.type === 'hub');
        return hub ? hub.position : new THREE.Vector3(0, 7, 0);
    }

    function teleportToHub() {
        const base = hubAnchor();
        state.tethered = false;
        if (world.weaver) world.weaver.tethered = false;
        if (world.silkLine) world.silkLine.visible = false;
        const tetherEl = document.getElementById('tether-warning');
        if (tetherEl) tetherEl.classList.remove('show');
        const damage = document.getElementById('damage-overlay');
        if (damage) damage.style.opacity = '0';
        camera.position.set(base.x + 4, base.y + 7, base.z + 14);
        camera.lookAt(base.x, base.y + 4, base.z);
        lookEuler.setFromQuaternion(camera.quaternion);
        velocity.set(0, 0, 0);
        state.depthHold = false;
    }

    function manualRecall() {
        if (!state.isPlaying) return false;
        if (state.recallCooldown > 0) {
            toast(`Rappel en recharge : ${Math.ceil(state.recallCooldown)} s.`, 'info', 'URGENCE');
            return false;
        }
        teleportToHub();
        state.o2 = Math.max(state.o2, Math.min(state.maxO2, 45));
        state.hull = Math.max(state.hull, 45);
        state.recallCooldown = 90;
        state.emergencyO2Used = false;
        PP.UI.closeAllModals();
        state.isPaused = false;
        PP.Audio.alarm();
        toast('Rappel d\'urgence exécuté : capsule atteinte. Réserves minimales restaurées.', 'success', 'URGENCE');
        updateHUDNow();
        saveGame(false);
        return true;
    }

    function fastTravel(poiId) {
        const poi = world && world.pois.find(p => p.id === poiId);
        if (!poi || !state.discoveredPois[poiId]) {
            toast('Voyage rapide impossible : point d\'intérêt non cartographié.', 'warn', 'NAVIGATION');
            return false;
        }
        if (state.tethered) {
            toast('Entrave active : tranchez le bio-câble avant tout voyage.', 'warn', 'NAVIGATION');
            return false;
        }
        if (state.o2 < 25) {
            toast('25 secondes d\'oxygène sont nécessaires pour un voyage rapide.', 'warn', 'NAVIGATION');
            return false;
        }
        state.o2 -= 25;
        const y = U.clamp(
            world.height(poi.x, poi.z) + 12,
            W.WATER_Y - state.maxCrushDepth / W.DEPTH_SCALE + 2,
            W.WATER_Y - 2.6
        );
        camera.position.set(poi.x, y, poi.z + 16);
        camera.lookAt(poi.x, world.height(poi.x, poi.z) + 5, poi.z);
        lookEuler.setFromQuaternion(camera.quaternion);
        velocity.set(0, 0, 0);
        state.depthHold = false;
        PP.UI.closeAllModals();
        state.isPaused = false;
        PP.Audio.scan();
        toast(`Voyage rapide : ${poi.short || poi.name}. 25 s d'O₂ consommées.`, 'success', 'NAVIGATION');
        updateHUDNow();
        saveGame(false);
        return true;
    }

    function useEmergencyO2() {
        if (state.emergencyO2Used) {
            toast('Réserve d\'urgence déjà consommée. Rechargez-la près d\'un module pressurisé.', 'warn', 'OXYGÈNE');
            return false;
        }
        state.emergencyO2Used = true;
        state.o2 = Math.min(state.maxO2, state.o2 + 48);
        PP.Audio.pickup();
        toast('Réserve d\'oxygène d\'urgence déployée : +48 s. Une seule charge par plongée.', 'success', 'OXYGÈNE');
        updateHUDNow();
        return true;
    }

    function fieldRepair() {
        if (state.fieldRepairCooldown > 0) {
            toast(`Kit de réparation en recharge : ${Math.ceil(state.fieldRepairCooldown)} s.`, 'info', 'SURVIE');
            return false;
        }
        if (state.hull >= 100) {
            toast('La coque est déjà intacte.', 'info', 'SURVIE');
            return false;
        }
        if ((state.inventory.bioGel || 0) < 1) {
            PP.Audio.error();
            toast('1 biogel réparateur requis pour un kit de terrain.', 'warn', 'SURVIE');
            return false;
        }
        state.inventory.bioGel -= 1;
        state.hull = Math.min(100, state.hull + 42);
        if (state.breach) state.breach.active = false;
        state.fieldRepairCooldown = 24;
        PP.Audio.craft();
        toast('Réparation de terrain : +42 % d\'intégrité. Biogel consommé.', 'success', 'SURVIE');
        updateHUDNow();
        return true;
    }

    function toggleDepthHold() {
        state.depthHold = !state.depthHold;
        if (state.depthHold) state.heldDepth = world.depthOf(camera.position.y);
        toast(state.depthHold
            ? `Pilote de profondeur verrouillé à ${Math.round(state.heldDepth)} m. [V] pour libérer.`
            : 'Pilote de profondeur libéré.', 'info', 'PILOTAGE');
        updateHUDNow();
    }

    /* ------------------------------------------------------------------ */
    /* PROTOCOLES AVANCÉS & ÉCONOMIE                                       */
    /* ------------------------------------------------------------------ */
    function powerSurge() {
        if (state.surgeCooldown > 0) {
            toast(`Surcharge en recharge : ${Math.ceil(state.surgeCooldown)} s.`, 'info', 'ÉNERGIE');
            return false;
        }
        state.surgeTimer = 30;
        state.surgeCooldown = 120;
        // Sans recalcul immédiat, la surcharge n'aurait aucun effet sur le
        // réseau tant qu'aucun module ne serait construit ou amélioré.
        if (factory) factory.recalcPower();
        PP.Audio.levelUp();
        toast('SURCHARGE : production électrique +50 % pendant 30 s. Les modules accélèrent.', 'success', 'PROTOCOLE');
        updateHUDNow();
        return true;
    }

    function silentRunning() {
        if (state.silenceCooldown > 0) {
            toast(`Silence acoustique en recharge : ${Math.ceil(state.silenceCooldown)} s.`, 'info', 'FURTIF');
            return false;
        }
        state.silenceTimer = 30;
        state.silenceCooldown = 95;
        state.stealthFactor = Math.min(state.stealthFactor || 1, 0.34);
        PP.Audio.scan();
        toast('SILENCE : émissions coupées, détection des prédateurs réduite de 66 % pendant 30 s.', 'success', 'PROTOCOLE');
        updateHUDNow();
        return true;
    }

    function emergencyAscent() {
        if (state.ascentCooldown > 0) {
            toast(`Remontée d\'urgence en recharge : ${Math.ceil(state.ascentCooldown)} s.`, 'info', 'URGENCE');
            return false;
        }
        const depth = world.depthOf(camera.position.y);
        if (depth < 70) {
            toast('Vous êtes déjà en zone sûre : aucune remontée nécessaire.', 'info', 'URGENCE');
            return false;
        }
        if (state.o2 < 18) {
            toast('18 s d\'O₂ requises pour la remontée d\'urgence.', 'warn', 'URGENCE');
            return false;
        }
        state.o2 -= 18;
        const targetY = W.WATER_Y - 38 / W.DEPTH_SCALE;
        camera.position.y = Math.max(targetY, world.height(camera.position.x, camera.position.z) + 2.2);
        velocity.y = 0;
        state.depthHold = false;
        state.ascentCooldown = 130;
        PP.Audio.alarm();
        toast('REMONTÉE D\'URGENCE : palier sûr atteint. 18 s d\'O₂ consommées.', 'success', 'PROTOCOLE');
        updateHUDNow();
        saveGame(false);
        return true;
    }

    function toggleAutoScan() {
        state.autoScan = !state.autoScan;
        state.autoScanTimer = 0;
        toast(state.autoScan
            ? 'Balayage automatique activé : un pulse sonar révèle les filons proches toutes les 12 s.'
            : 'Balayage automatique désactivé.', 'info', 'SONAR');
        updateHUDNow();
        return state.autoScan;
    }

    function autoScanPulse() {
        if (state.powerProduced <= state.powerConsumed && state.powerProduced > 0) return 0;
        let found = 0;
        world.nodes.forEach((node, index) => {
            if (node.stock <= 0 || state.discoveredNodes.includes(index)) return;
            if (node.position.distanceTo(camera.position) < 190) {
                state.discoveredNodes.push(index);
                found++;
            }
        });
        (world.salvage || []).forEach(cache => {
            if (cache.collected || cache.revealed) return;
            if (cache.position.distanceTo(camera.position) < 130) { cache.revealed = true; found++; }
        });
        if (found > 0) {
            PP.Audio.sonar();
            toast(`Balayage automatique : ${found} signature(s) ajoutée(s) à la carte.`, 'success', 'SONAR');
            updateHUDNow();
        }
        return found;
    }

    function sellResource(key, qty = 1) {
        if (!D.RESOURCES[key]) return false;
        const amount = Math.max(1, Math.floor(qty));
        const have = Math.floor(state.inventory[key] || 0);
        if (have < amount) {
            toast('Stock insuffisant pour cette vente.', 'warn', 'MARCHÉ');
            return false;
        }
        const value = marketValue(key) * amount;
        state.inventory[key] -= amount;
        state.credits = (state.credits || 0) + Math.round(value * difficultyProfile().credits);
        PP.Audio.pickup();
        toast(`Vente : ${amount} × ${D.RESOURCES[key].name} → +${Math.round(value * difficultyProfile().credits)} crédits.`, 'success', 'MARCHÉ');
        if (PP.UI) { PP.UI.renderInventory(); PP.UI.renderJournal(); }
        updateHUDNow();
        saveGame(false);
        return true;
    }

    function marketValue(key) {
        const info = D.RESOURCES[key];
        if (!info) return 0;
        return info.tier === 'refined' ? 14 + Math.round(key.length * 0.6) : 4 + Math.round(key.length * 0.35);
    }

    function buyMarket(key) {
        const offers = { bioGel: 38, lithiumCell: 26, glassPane: 20, magnetCoil: 44, thermicAlloy: 52 };
        if (!offers[key]) return false;
        const price = offers[key];
        if ((state.credits || 0) < price) {
            toast(`${price} crédits requis pour cet achat.`, 'warn', 'MARCHÉ');
            return false;
        }
        state.credits -= price;
        state.inventory[key] = (state.inventory[key] || 0) + 1;
        PP.Audio.craft();
        toast(`Achat : +1 ${D.RESOURCES[key].name} pour ${price} crédits.`, 'success', 'MARCHÉ');
        if (PP.UI) { PP.UI.renderInventory(); PP.UI.renderJournal(); }
        updateHUDNow();
        saveGame(false);
        return true;
    }

    function addCredits(amount) {
        state.credits = Math.max(0, (state.credits || 0) + Math.round(amount));
    }

    function cyclePhotoFilter() {
        state.photoFilter = ((state.photoFilter || 0) + 1) % 4;
        applyPhotoFilter();
        const labels = ['Naturel', 'Abyssal', 'Thermique', 'Monochrome'];
        toast(`Filtre photo : ${labels[state.photoFilter]}.`, 'info', 'PHOTO');
        return state.photoFilter;
    }

    function applyPhotoFilter() {
        document.body.classList.remove('filter-abyssal', 'filter-thermal', 'filter-mono');
        const map = ['', 'filter-abyssal', 'filter-thermal', 'filter-mono'];
        if (state.photoMode && map[state.photoFilter || 0]) document.body.classList.add(map[state.photoFilter || 0]);
    }

    function repeatLastBuild() {
        if (!state.lastBuildType) return false;
        const def = D.BUILDINGS[state.lastBuildType];
        if (!def || def.type === 'hub') return false;
        if (def.tech && !state.unlockedTechs[def.tech]) {
            toast('Technologie requise pour reconstruire ce module.', 'warn', 'CONSTRUCTION');
            return false;
        }
        selectBuildType(state.lastBuildType);
        toast(`Module précédent resélectionné : ${def.name}.`, 'info', 'CONSTRUCTION');
        return true;
    }

    function addMapMarker(x, z, label) {
        if (!Array.isArray(state.mapMarkers)) state.mapMarkers = [];
        if (state.mapMarkers.length >= 8) {
            toast('Huit marqueurs personnels maximum. Effacez-en un pour continuer.', 'warn', 'CARTE');
            return false;
        }
        state.mapMarkers.push({ x: Math.round(x), z: Math.round(z), label: label || `Marqueur ${state.mapMarkers.length + 1}` });
        PP.Audio.pickup();
        toast('Marqueur personnel ajouté à la carte.', 'success', 'CARTE');
        saveGame(false);
        return true;
    }

    function clearMapMarkers() {
        state.mapMarkers = [];
        toast('Marqueurs personnels effacés.', 'info', 'CARTE');
        saveGame(false);
    }

    function currentAt(x, z) {
        const scale = 0.0016;
        const t = elapsed * 0.08;
        let vx = Math.sin(z * scale + t) * Math.cos(x * scale * 0.7 - t * 0.6);
        let vz = Math.cos(x * scale - t * 0.8) * Math.sin(z * scale * 0.8 + t);
        const depthBoost = U.clamp(world.depthOf(camera.position.y) / 1200, 0.25, 1);
        const strength = 2.2 * depthBoost;
        vx *= strength; vz *= strength;
        return { x: vx, z: vz, speed: Math.hypot(vx, vz) };
    }

    function updateCartography(dt) {
        if (!state.regionCells) state.regionCells = {};
        if (!state.masteryClaims) state.masteryClaims = {};
        const x = camera.position.x, z = camera.position.z;
        const region = world.regionAt(x, z);
        if (region.id === 'rift') return;
        const cell = `${Math.floor(x / 260)},${Math.floor(z / 260)}`;
        state.regionCells[region.id] = state.regionCells[region.id] || {};
        state.regionCells[region.id][cell] = 1;
        const visited = Object.keys(state.regionCells[region.id]).length;
        const total = Math.max(24, Math.round((Math.PI * region.radius * region.radius) / (260 * 260)));
        const pct = Math.min(100, Math.round((visited / total) * 100));
        const claims = state.masteryClaims[region.id] || [];
        [25, 50, 75, 100].forEach(threshold => {
            if (pct >= threshold && !claims.includes(threshold)) {
                claims.push(threshold);
                addCredits(60 + threshold);
                addXp(40 + threshold * 0.6);
                if (threshold === 50) addRewards({ lithiumCell: 1 });
                if (threshold === 100) addRewards({ quantumCore: 1 });
                PP.Audio.levelUp();
                toast(`Cartographie ${region.name} : ${threshold} % — prime coloniale +${60 + threshold} crédits.`, 'success', 'CARTOGRAPHIE');
            }
        });
        state.masteryClaims[region.id] = claims;
    }

    function revealNearby() {
        let found = 0;
        world.nodes.forEach((node, index) => {
            if (node.stock > 0 && !state.discoveredNodes.includes(index) && node.position.distanceTo(camera.position) < 240) {
                state.discoveredNodes.push(index); found++;
            }
        });
        return found;
    }

    function scanFauna() {
        if (!state.isPlaying || state.isPaused) return false;
        if (state.scanCooldown > 0) {
            toast(`Bio-scanner en recharge : ${Math.ceil(state.scanCooldown)} s.`, 'info', 'XÉNO-BIOLOGIE');
            return false;
        }
        const species = world.nearestSpecies(camera.position);
        if (!species) {
            toast('Aucune signature biologique dans le rayon du scanner.', 'info', 'XÉNO-BIOLOGIE');
            return false;
        }
        const info = D.FAUNA[species];
        const discovered = !!state.codex[`fauna-${species}`];
        const added = unlockCodex(`fauna-${species}`, true);
        addXp(added ? 55 : 18);
        state.scanCooldown = 10;
        PP.Audio.scan();
        toast(`${info.name} · ${info.latin} · danger ${info.danger}/4${discovered ? ' · signature déjà archivée' : ' · nouvelle entrée au codex'}.`, 'xeno', 'BIO-SCAN');
        updateHUDNow();
        return true;
    }

    function toggleNodeHighlight() {
        state.nodeHighlight = !state.nodeHighlight;
        if (world && world.setNodeHighlight) world.setNodeHighlight(state.nodeHighlight);
        toast(state.nodeHighlight
            ? 'Surbrillance des gisements active : les filons proches s\'illuminent.'
            : 'Surbrillance des gisements désactivée.', 'info', 'SONAR');
        updateHUDNow();
    }

    function rerollContracts() {
        if ((state.inventory.copperWire || 0) < 2) {
            PP.Audio.error();
            toast('2 fils de cuivre sont requis pour renouveler le tableau des contrats.', 'warn', 'COLONIE');
            return false;
        }
        state.inventory.copperWire -= 2;
        state.contracts = [];
        ensureContracts();
        PP.Audio.contract();
        toast('Nouveau tableau de contrats : trois commandes de la colonie émises.', 'success', 'COLONIE');
        if (PP.UI) { PP.UI.renderJournal(); PP.UI.updateMenu(); }
        updateHUDNow();
        saveGame(false);
        return true;
    }

    function togglePhotoMode() {
        const entering = !state.photoMode;
        state.photoMode = entering;
        if (entering) {
            // Le mode photo doit rendre le pilotage immédiatement disponible,
            // même lorsqu'il est lancé depuis le menu pause. Sinon la caméra
            // resterait figée derrière un panneau fermé.
            state.isPaused = false;
            clearPressedKeys();
            if (PP.UI && PP.UI.closeAllModals) PP.UI.closeAllModals();
        }
        document.body.classList.toggle('photo-mode', state.photoMode);
        applyPhotoFilter();
        if (entering) {
            if (document.pointerLockElement) document.exitPointerLock();
            toast('Mode photo : HUD masqué. F2 pour revenir à la sonde.', 'info', 'PHOTO');
        } else {
            toast('Mode photo désactivé.', 'info', 'PHOTO');
            if (state.isPlaying) PP.UI.setHUDVisible(true);
        }
        return state.photoMode;
    }

    function exportSave() {
        if (!world) return false;
        try {
            const payload = JSON.stringify(serialize(), null, 2);
            const blob = new Blob([payload], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `thalassa-iv-expedition-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast('Sauvegarde exportée au format JSON.', 'success', 'SYSTÈME');
            return true;
        } catch (error) {
            console.error('Export impossible', error);
            toast('Export impossible : stockage ou navigateur indisponible.', 'danger', 'SYSTÈME');
            return false;
        }
    }

    function importSave(text) {
        try {
            if (typeof text !== 'string' || text.length > 8 * 1024 * 1024) throw new Error('fichier trop volumineux');
            const parsed = JSON.parse(text);
            if (!isValidSavePayload(parsed)) throw new Error('format invalide');
            const previous = localStorage.getItem(SAVE_KEY);
            if (previous) {
                try {
                    if (isValidSavePayload(JSON.parse(previous))) localStorage.setItem(SAVE_BACKUP_KEY, previous);
                } catch (backupError) { /* ne pas écraser le secours avec une save illisible */ }
            }
            localStorage.setItem(SAVE_KEY, JSON.stringify(parsed));
            return true;
        } catch (error) {
            // Un fichier invalide est une erreur de saisie attendue :
            // on la signale sans polluer la console comme une panne.
            console.warn('Import refusé :', error && error.message ? error.message : error);
            return false;
        }
    }

    function quickLoad() {
        if (!saveExists()) return false;
        location.reload();
        return true;
    }

    /* ------------------------------------------------------------------ */
    /* SURVIE : OXYGÈNE, CHALEUR, FAUNE, INTÉGRITÉ                        */
    /* ------------------------------------------------------------------ */
    const survival = {
        o2Alarm: 0, breachAlarm: 0, heartbeat: 0, hypoxiaHint: 0,
        heatTick: 0, heatHint: 0, predatorTick: 0, jellyTick: 0,
        lastHeat: 0, lastSting: 0
    };

    let cartographyAccumulator = 0;
    let salvageHintCooldown = 0;

    function updateOps(dt) {
        state.surgeCooldown = Math.max(0, (state.surgeCooldown || 0) - dt);
        state.silenceCooldown = Math.max(0, (state.silenceCooldown || 0) - dt);
        state.ascentCooldown = Math.max(0, (state.ascentCooldown || 0) - dt);
        if (state.surgeTimer > 0) {
            state.surgeTimer = Math.max(0, state.surgeTimer - dt);
            if (state.surgeTimer === 0) {
                if (factory) factory.recalcPower();
                toast('Surcharge réseau terminée : production nominale rétablie.', 'info', 'ÉNERGIE');
            }
        }
        if (state.silenceTimer > 0) {
            state.silenceTimer = Math.max(0, state.silenceTimer - dt);
            state.stealthFactor = Math.min(state.stealthFactor || 1, 0.34);
            if (state.silenceTimer === 0) {
                applyRelicEffects();
                toast('Silence acoustique terminé : émissions rétablies.', 'info', 'FURTIF');
            }
        }

        cartographyAccumulator += dt;
        if (cartographyAccumulator > 1.2) {
            cartographyAccumulator = 0;
            updateCartography(dt);
        }

        if (state.autoScan) {
            state.autoScanTimer = (state.autoScanTimer || 0) + dt;
            if (state.autoScanTimer > 12) {
                state.autoScanTimer = 0;
                autoScanPulse();
            }
        }

        // Épaves de récupération : collecte automatique au contact.
        if (world.salvage) {
            salvageHintCooldown = Math.max(0, salvageHintCooldown - dt);
            for (let i = 0; i < world.salvage.length; i++) {
                const cache = world.salvage[i];
                if (cache.collected) continue;
                const d = cache.position.distanceTo(camera.position);
                if (d > 74 && d < 78 && salvageHintCooldown <= 0) {
                    salvageHintCooldown = 30;
                    toast('Balise de détresse détectée : une épave de ravitaillement émet à proximité.', 'info', 'ÉPAVE');
                }
                if (d < 7.5) {
                    cache.collected = true;
                    if (cache.group) cache.group.visible = false;
                    state.cacheTaken[cache.id] = true;
                    const credits = 35 + Math.round(Math.random() * 40);
                    addCredits(credits * difficultyProfile().credits);
                    addRewards(cache.loot || { titaniumOre: 2 });
                    addXp(35);
                    PP.Audio.pickup();
                    toast(`Épave ${cache.name} fouillée : +${Math.round(credits * difficultyProfile().credits)} crédits et composants récupérés.`, 'success', 'ÉPAVE');
                    updateHUDNow();
                    saveGame(false);
                }
            }
        }

        // Brèche de coque : fuite d'O₂ tant que la réparation n'est pas faite.
        const breach = state.breach || (state.breach = { active: false, timer: 0 });
        if (state.hull < 35 && !breach.active) {
            breach.active = true;
            PP.Audio.alarm();
            toast('BRÈCHE DE COQUE : fuite d\'O₂ détectée. Utilisez [K] avec 1 biogel pour colmater.', 'danger', 'COQUE');
        }
        if (breach.active) {
            if (state.hull >= 45) {
                breach.active = false;
            } else {
                state.o2 = Math.max(0, state.o2 - dt * 1.35);
                breach.timer = (breach.timer || 0) + dt;
                if (breach.timer > 8) {
                    breach.timer = 0;
                    PP.Audio.hull();
                    toast('La brèche continue de vider la réserve d\'oxygène.', 'danger', 'COQUE');
                }
            }
        }
        const breachEl = document.getElementById('breach-alert');
        if (breachEl) breachEl.classList.toggle('show', breach.active);
    }

    function updateSurvival(dt) {
        const pos = camera.position;
        const depth = world.depthOf(pos.y);
        const o2Ratio = state.maxO2 > 0 ? state.o2 / state.maxO2 : 0;
        state.fieldRepairCooldown = Math.max(0, (state.fieldRepairCooldown || 0) - dt);
        state.scanCooldown = Math.max(0, (state.scanCooldown || 0) - dt);
        state.recallCooldown = Math.max(0, (state.recallCooldown || 0) - dt);

        // Paliers de profondeur : chaque seuil franchi verse une prime unique.
        const milestones = [250, 500, 750, 1000, 1250, 1500, 1800, 2100, 2400, 2700, 3000];
        for (let i = 0; i < milestones.length; i++) {
            const m = milestones[i];
            if (depth < m || state.depthMilestones[m]) continue;
            state.depthMilestones[m] = true;
            addRewards({ lithiumCell: 1 + Math.floor(i / 4) });
            addXp(45 + m / 12);
            PP.Audio.levelUp();
            toast(`Palier ${m} m franchi · prime de pression : ${1 + Math.floor(i / 4)} cellule(s) lithium · +${Math.round(45 + m / 12)} XP.`, 'success', 'PROFONDEUR');
            updateHUDNow();
            saveGame(false);
        }

        // --- Oxygène : détresse respiratoire progressive ------------------
        const hypoxia = document.getElementById('hypoxia-overlay');
        if (hypoxia) {
            const intensity = U.clamp((0.42 - o2Ratio) / 0.42, 0, 1);
            hypoxia.style.opacity = String(intensity * 0.85);
            hypoxia.classList.toggle('critical', o2Ratio < 0.12);
        }
        if (o2Ratio < 0.28) {
            survival.o2Alarm -= dt;
            if (survival.o2Alarm <= 0) {
                survival.o2Alarm = o2Ratio < 0.12 ? 1.1 : 2.6;
                PP.Audio.alarm();
                if (survival.hypoxiaHint <= 0) {
                    survival.hypoxiaHint = 26;
                    toast(
                        o2Ratio < 0.12
                            ? 'Oxygène critique. Rejoignez la capsule ou un habitat immédiatement.'
                            : 'Réserve d\'O₂ basse. Recherchez une structure pressurisée.',
                        'danger', 'SURVIE'
                    );
                }
            }
            survival.hypoxiaHint = Math.max(0, survival.hypoxiaHint - dt);
        } else {
            survival.o2Alarm = 0;
            survival.hypoxiaHint = 0;
        }
        if (o2Ratio < 0.2) {
            survival.heartbeat -= dt;
            if (survival.heartbeat <= 0) {
                survival.heartbeat = U.lerp(1.5, 0.55, U.clamp((0.2 - o2Ratio) / 0.2, 0, 1));
                PP.Audio.heartbeat();
            }
        }

        // --- Chaleur des cheminées hydrothermales -------------------------
        let heatSource = null;
        if (world.vents) {
            for (let i = 0; i < world.vents.length; i++) {
                const vent = world.vents[i];
                const dx = pos.x - vent.position.x;
                const dz = pos.z - vent.position.z;
                const planar = Math.hypot(dx, dz);
                if (planar > 10.5) continue;
                const top = vent.position.y + (vent.height || 0) + 4;
                if (pos.y > top + 8 || pos.y < vent.position.y - 3) continue;
                heatSource = { vent, planar };
                break;
            }
        }
        if (heatSource) {
            const exposure = U.clamp(1 - heatSource.planar / 10.5, 0, 1);
            const insulation = state.unlockedTechs.hullMk3 ? 0.45 : 1;
            const burn = (2.4 + exposure * 7.5) * insulation * (1 - state.hullResist) * dt;
            state.hull = Math.max(0, state.hull - burn);
            survival.heatTick -= dt;
            if (survival.heatTick <= 0) {
                survival.heatTick = 0.85;
                PP.Audio.hull();
                const damage = document.getElementById('damage-overlay');
                if (damage) damage.style.opacity = String(U.clamp(0.18 + exposure * 0.4, 0.18, 0.6));
            }
            survival.heatHint -= dt;
            if (survival.heatHint <= 0) {
                survival.heatHint = 20;
                toast('Fumerolles à 340 °C : la coque fond. Reculez ou isolez la prise géothermique à distance.', 'danger', 'THERMIQUE');
            }
        } else {
            survival.heatTick = 0;
            survival.heatHint = Math.max(0, survival.heatHint - dt);
        }

        // --- Faune : méduses et chasseurs du vide -------------------------
        survival.jellyTick = Math.max(0, survival.jellyTick - dt);
        if (world.jellies && survival.jellyTick <= 0) {
            for (let i = 0; i < world.jellies.length; i++) {
                if (pos.distanceTo(world.jellies[i].mesh.position) < 5.2) {
                    survival.jellyTick = 7;
                    state.hull = Math.max(0, state.hull - 6.5 * (1 - state.hullResist));
                    PP.Audio.hull();
                    const damage = document.getElementById('damage-overlay');
                    if (damage) damage.style.opacity = '0.5';
                    toast('Piqûre de méduse de verre : neurotoxine détectée, coque fragilisée.', 'danger', 'XÉNO-BIOLOGIE');
                    break;
                }
            }
        }

        survival.predatorTick = Math.max(0, survival.predatorTick - dt);
        if (world.predators && survival.predatorTick <= 0) {
            for (let i = 0; i < world.predators.length; i++) {
                const predator = world.predators[i];
                const d = pos.distanceTo(predator.mesh.position);
                if (d > 26) continue;
                const stealthFactor = state.stealthFactor || 1;
                if (d > 13 * stealthFactor) continue;
                survival.predatorTick = 9;
                state.hull = Math.max(0, state.hull - (7 + (1 - d / 13) * 7) * (1 - state.hullResist));
                PP.Audio.weaver();
                const damage = document.getElementById('damage-overlay');
                if (damage) damage.style.opacity = '0.62';
                const flee = pos.clone().sub(predator.mesh.position).setY(0.35).normalize();
                camera.position.addScaledVector(flee, 3.4);
                velocity.addScaledVector(flee, 9);
                toast('Chasseur du vide : charge encaissée. Coupez les foreuses ou activez le placage acoustique.', 'danger', 'DANGER');
                break;
            }
        }

        // --- Alerte d'intégrité -------------------------------------------
        if (state.hull < 30) {
            survival.breachAlarm -= dt;
            if (survival.breachAlarm <= 0) {
                survival.breachAlarm = 4.5;
                PP.Audio.alarm();
                toast('Intégrité de coque sous 30 %. Réparation possible près de la capsule ou d\'un habitat.', 'danger', 'COQUE');
            }
        } else {
            survival.breachAlarm = 0;
        }

        // --- Récupération passive d'oxygène en zone photique --------------
        if (depth < 60 && state.o2 < state.maxO2 && !state.tethered) {
            const nearSurface = W.WATER_Y - pos.y < 42;
            if (nearSurface) state.o2 = Math.min(state.maxO2, state.o2 + dt * 1.6);
        }
    }

    /* ------------------------------------------------------------------ */
    /* REGARD & ENTRÉES                                                    */
    /* ------------------------------------------------------------------ */
    function bindControls() {
        window.addEventListener('keydown', e => {
            const oneShot = ['Escape', 'KeyE', 'KeyF', 'KeyT', 'KeyM', 'KeyI', 'KeyB', 'KeyJ', 'KeyC', 'KeyO', 'KeyR', 'KeyX', 'KeyG', 'KeyY', 'KeyP', 'KeyH', 'KeyL', 'KeyU', 'KeyK', 'KeyV', 'KeyN', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10'];
            if (oneShot.includes(e.code) && e.repeat) return;
            if (['F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10'].includes(e.code)) e.preventDefault();
            if (state.isPlaying && !PP.UI.anyModalOpen() && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
            keys[e.code] = true;

            const activeEl = document.activeElement;
            const typing = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
            if (e.code === 'Escape' || (e.code === 'Backspace' && !typing)) {
                e.preventDefault();
                if (PP.UI.handleEscape()) return;
                if (e.code === 'Backspace' && state.isPlaying) {
                    if (state.isPaused) resume();
                    else pause();
                    return;
                }
                if (state.isPlaying) {
                    if (state.isPaused) resume();
                    else pause();
                }
                return;
            }
            if (!state.isPlaying) return;

            if (e.code === 'KeyI') { if (PP.UI.isOpen('modal-inventory')) PP.UI.closeModal('modal-inventory'); else PP.UI.openInventory(); return; }
            if (e.code === 'KeyT') { if (PP.UI.isOpen('modal-tech')) PP.UI.closeModal('modal-tech'); else PP.UI.openTech(); return; }
            if (e.code === 'KeyM') { if (PP.UI.isOpen('modal-map')) PP.UI.closeModal('modal-map'); else PP.UI.openMap(); return; }
            if (e.code === 'KeyB') { if (PP.UI.isOpen('modal-catalog')) PP.UI.closeModal('modal-catalog'); else PP.UI.openCatalog(); return; }
            if (e.code === 'KeyJ') { if (PP.UI.isOpen('modal-journal')) PP.UI.closeModal('modal-journal'); else PP.UI.openJournal(); return; }
            if (e.code === 'KeyC') { if (PP.UI.isOpen('modal-codex')) PP.UI.closeModal('modal-codex'); else PP.UI.openCodex(); return; }
            if (e.code === 'KeyO') { if (PP.UI.isOpen('modal-settings')) PP.UI.closeModal('modal-settings'); else PP.UI.openSettings(); return; }
            if (e.code === 'KeyH') {
                if (PP.UI.isOpen('modal-pause') || state.isPaused) return;
                if (PP.UI.isOpen('modal-help')) PP.UI.closeModal('modal-help');
                else PP.UI.openHelp();
                return;
            }
            // Libère ou reprend le pilotage sans passer par le menu pause.
            if (e.code === 'KeyL') {
                if (PP.UI.anyModalOpen()) return;
                if (document.pointerLockElement) {
                    document.exitPointerLock();
                    toast('Curseur libéré. Cliquez dans l\'océan pour reprendre le pilotage.', 'info', 'PILOTAGE');
                } else {
                    requestPointerLock();
                }
                return;
            }
            if (e.code === 'KeyP') {
                if (PP.UI.isOpen('modal-pause')) { PP.UI.closeModal('modal-pause'); resume(); }
                else if (PP.UI.anyModalOpen()) { PP.UI.closeAllModals(); pause(); }
                else if (state.isPaused) resume();
                else pause();
                return;
            }
            // Raccourcis de session utilisables même avec un panneau ouvert.
            if (e.code === 'F2') {
                if (PP.UI.anyModalOpen()) PP.UI.closeAllModals();
                togglePhotoMode();
                return;
            }
            if (e.code === 'F5') {
                const saved = saveGame(true);
                if (PP.UI.isOpen('modal-pause')) {
                    const fb = document.getElementById('pause-feedback');
                    if (fb) fb.textContent = saved ? '✓ Sauvegarde rapide enregistrée.' : '✕ Échec de la sauvegarde rapide.';
                    PP.UI.refreshPauseStats && PP.UI.refreshPauseStats();
                }
                return;
            }
            if (e.code === 'F9') {
                if (!saveExists()) { toast('Aucune sauvegarde locale à recharger.', 'warn', 'SYSTÈME'); return; }
                quickLoad();
                return;
            }
            if (e.code === 'F8') {
                manualRecall();
                return;
            }

            if (PP.UI.anyModalOpen() || state.isPaused) return;
            if (e.code === 'KeyU') { useEmergencyO2(); return; }
            if (e.code === 'KeyK') { fieldRepair(); return; }
            if (e.code === 'KeyV') { toggleDepthHold(); return; }
            if (e.code === 'KeyN') { toggleNodeHighlight(); return; }
            if (e.code === 'F3') { emergencyAscent(); return; }
            if (e.code === 'F4') { scanFauna(); return; }
            if (e.code === 'F6') { powerSurge(); return; }
            if (e.code === 'F7') { silentRunning(); return; }
            if (e.code === 'F10') { toggleAutoScan(); return; }
            if (e.code === 'KeyY') { repeatLastBuild(); return; }
            if (e.key >= '1' && e.key <= '9') {
                const index = parseInt(e.key, 10) - 1;
                selectTool(index);
                return;
            }
            if (e.code === 'KeyF') { useSonar(); return; }
            if (e.code === 'KeyR') {
                state.buildRotation = (state.buildRotation + Math.PI / 4) % (Math.PI * 2);
                PP.Audio.click();
                return;
            }
            if (e.code === 'KeyG') {
                state.gridSnap = !state.gridSnap;
                toast(`Grille de construction ${state.gridSnap ? 'activée (4 m)' : 'désactivée'}.`, 'info', 'CHANTIER');
                return;
            }
            if (e.code === 'KeyE') { interactHovered(); return; }
            if (e.code === 'KeyX') { dismantleHovered(); return; }
        });

        window.addEventListener('keyup', e => { keys[e.code] = false; });
        window.addEventListener('blur', clearPressedKeys);

        document.addEventListener('pointerlockchange', () => {
            state.pointerLocked = document.pointerLockElement === canvas;
        });

        document.addEventListener('mousemove', e => {
            if (!state.isPlaying || PP.UI.anyModalOpen() || state.isPaused) return;
            const sensitivity = state.settings.sensitivity;
            if (state.pointerLocked) {
                applyLook(e.movementX * 0.0022 * sensitivity, e.movementY * 0.0022 * sensitivity);
            } else if (isDraggingLook) {
                const dx = e.clientX - lastMouseX;
                const dy = e.clientY - lastMouseY;
                lastMouseX = e.clientX;
                lastMouseY = e.clientY;
                applyLook(dx * 0.0042 * sensitivity, dy * 0.0042 * sensitivity);
            }
        });

        window.addEventListener('mouseup', e => {
            isDraggingLook = false;
            if (e.button === 0) state.mouseDown = false;
        });
        window.addEventListener('contextmenu', e => e.preventDefault());

        canvas.addEventListener('mousedown', e => {
            if (!state.isPlaying || state.isPaused || PP.UI.anyModalOpen()) return;
            if (e.button === 2) {
                isDraggingLook = true;
                lastMouseX = e.clientX;
                lastMouseY = e.clientY;
                state.pipeSource = null;
                return;
            }
            if (e.button !== 0) return;
            requestPointerLock();
            state.mouseDown = true;
            handlePrimaryAction();
        });

        canvas.addEventListener('mouseup', e => {
            if (e.button === 2) isDraggingLook = false;
        });

        window.addEventListener('beforeunload', () => {
            if (state.isPlaying) saveGame(false);
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && state.isPlaying && !state.isPaused && !PP.UI.anyModalOpen()) pause();
        });
    }

    function applyLook(dx, dy) {
        lookEuler.setFromQuaternion(camera.quaternion);
        lookEuler.y -= dx;
        lookEuler.x -= dy * (state.settings.invertY ? -1 : 1);
        lookEuler.x = U.clamp(lookEuler.x, -1.45, 1.45);
        lookEuler.z = 0;
        camera.quaternion.setFromEuler(lookEuler);
    }

    function requestPointerLock() {
        if (!canvas.requestPointerLock || state.pointerLocked) return;
        try {
            const result = canvas.requestPointerLock();
            if (result && typeof result.catch === 'function') result.catch(() => { /* viseur libre : glisser pour regarder */ });
        } catch (error) { /* fallback drag */ }
    }

    /* ------------------------------------------------------------------ */
    /* INTERACTIONS                                                        */
    /* ------------------------------------------------------------------ */
    function currentBuildDef() {
        return state.currentBuild ? D.BUILDINGS[state.currentBuild] : null;
    }

    function collectInteractables() {
        interactables.length = 0;
        if (world) {
            world.nodeMeshes.forEach(m => interactables.push(m));
            world.pois.forEach(p => interactables.push(p.group));
            (world.relics || []).forEach(r => { if (!r.collected) interactables.push(r.group); });
            world.vents.forEach(v => interactables.push(v.mesh));
            if (world.weaver) interactables.push(world.weaver.group);
        }
        if (factory) factory.interactables.forEach(m => interactables.push(m));
    }

    function updateInteract() {
        collectInteractables();
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const hits = raycaster.intersectObjects(interactables, true);
        hoveredEntity = null;
        if (hits.length) {
            const hit = hits[0];
            let obj = hit.object;
            let entity = null;
            if (obj.userData && obj.userData.entity) entity = obj.userData.entity;
            if (!entity && obj.userData && obj.userData.nodes && hit.instanceId !== undefined) {
                entity = obj.userData.nodes[hit.instanceId];
            }
            while (!entity && obj && obj.parent) {
                obj = obj.parent;
                if (obj.userData && obj.userData.entity) entity = obj.userData.entity;
            }
            hoveredEntity = entity;
        }

        if (world) {
            world.setSelection(hoveredEntity && hoveredEntity.kind === 'node' ? hoveredEntity : null);
        }

        // Ghost de construction
        const def = currentBuildDef();
        if (def && factory) {
            const target = samplePlacement();
            if (target) {
                if (state.gridSnap) {
                    target.x = Math.round(target.x / 4) * 4;
                    target.z = Math.round(target.z / 4) * 4;
                    target.y = world.height(target.x, target.z);
                }
                const placement = factory.validate(def, target.x, target.z);
                placementData = placement;
                state.placementValid = placement.ok && hasCost(def.cost);
                factory.updateGhost(def, placement, state.buildRotation);
            } else {
                placementData = null;
                state.placementValid = false;
                if (factory.ghost) factory.ghost.visible = false;
            }
        } else if (factory && factory.ghost) {
            placementData = null;
            state.placementValid = false;
            factory.ghost.visible = false;
        }

        updatePrompt();
    }

    function samplePlacement() {
        const origin = camera.position.clone();
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        let previous = origin.clone();
        for (let t = 2.5; t < 115; t += 1.4) {
            const point = origin.clone().addScaledVector(dir, t);
            const h = world.height(point.x, point.z);
            if (point.y <= h) {
                // Raffinement entre les deux échantillons
                const lo = previous, hi = point;
                let best = hi.clone(); best.y = h;
                for (let i = 0; i < 5; i++) {
                    const mid = lo.clone().lerp(hi, 0.5);
                    if (mid.y <= world.height(mid.x, mid.z)) { hi.copy(mid); best = mid; }
                    else lo.copy(mid);
                }
                best.y = world.height(best.x, best.z);
                if (Math.abs(best.x) > W.HALF - 20 || Math.abs(best.z) > W.HALF - 20) return null;
                return best;
            }
            previous.copy(point);
        }
        return null;
    }

    function updatePrompt() {
        const prompt = document.getElementById('interaction-prompt');
        const key = document.getElementById('prompt-key');
        const text = document.getElementById('prompt-text');
        const crosshair = document.getElementById('crosshair');
        if (!prompt || !key || !text) return;
        let show = false, keyLabel = 'E', label = '';
        const tool = state.selectedTool;

        if (state.tethered) {
            show = true; keyLabel = 'CLIC [1]'; label = 'Trancher le bio-câble du Tisserand';
        } else if (hoveredEntity) {
            const e = hoveredEntity;
            if (e.kind === 'node' && tool === 0) {
                show = true; keyLabel = 'MAINTENIR CLIC';
                label = `Extraire ${D.RESOURCES[e.resourceType].name} · ${e.stock} restant(s)`;
            } else if (e.kind === 'building') {
                show = true; keyLabel = 'E';
                label = tool === 5 ? (state.pipeSource ? `Connecter à ${e.name}` : `Départ convoyeur : ${e.name}`) : `Configurer ${e.name}`;
            } else if (e.kind === 'poi') {
                show = true; keyLabel = 'E';
                label = `Analyser : ${e.discovered ? e.name : 'signal non identifié'}`;
            } else if (e.kind === 'relic') {
                show = true; keyLabel = 'E';
                label = `Recueillir : ${e.name} · ${e.bonus}`;
            } else if (e.kind === 'weaver') {
                show = true; keyLabel = tool === 8 ? 'CLIC' : 'DANGER';
                label = tool === 8 ? 'Décharge électrostatique sur le Tisserand' : 'Tisserand abyssal · distance critique';
            } else if (e.kind === 'vent') {
                show = true; keyLabel = 'E'; label = 'Cheminée hydrothermale · bonus géothermique +70 MW';
            }
        }

        prompt.classList.toggle('show', show);
        if (show) {
            key.textContent = keyLabel;
            text.textContent = label;
        }
        if (crosshair) crosshair.classList.toggle('active', !!(hoveredEntity && (hoveredEntity.kind === 'node' || hoveredEntity.kind === 'weaver')));
    }

    function hasCost(cost) {
        return Object.entries(cost || {}).every(([k, v]) => (state.inventory[k] || 0) >= v);
    }

    function handlePrimaryAction() {
        if (state.tethered && state.selectedTool === 0) { cutTether(); return; }
        if (state.selectedTool === 8) { fireArc(); return; }

        const def = currentBuildDef();
        if (def) {
            if (!placementData || !state.placementValid) {
                PP.Audio.error();
                toast(placementData ? placementData.reason || 'Emplacement invalide.' : 'Visez une surface plane du plancher océanique.', 'warn', 'CHANTIER');
                return;
            }
            if (!hasCost(def.cost)) {
                PP.Audio.error();
                toast(`Ressources insuffisantes : ${Object.entries(def.cost).map(([k, v]) => `${v} ${D.RESOURCES[k].short}`).join(' · ')}`, 'warn', 'CHANTIER');
                return;
            }
            const result = factory.place(def, placementData, state.buildRotation);
            if (!result.ok) {
                PP.Audio.error();
                toast(result.reason, 'warn', 'CHANTIER');
                return;
            }
            addXp(35);
            state.stats.regionsFound = Object.keys(state.visitedRegions).length;
            updateHUDNow();
            saveGame(false);
            return;
        }

        if (state.selectedTool === 5) {
            if (!hoveredEntity || hoveredEntity.kind !== 'building') {
                PP.Audio.error();
                toast('Cliquez sur un bâtiment source puis sur un bâtiment destination.', 'warn', 'LOGISTIQUE');
                return;
            }
            if (!state.pipeSource) {
                state.pipeSource = hoveredEntity;
                PP.Audio.click();
                toast(`Source sélectionnée : ${hoveredEntity.name}. Cliquez maintenant la destination.`, 'info', 'LOGISTIQUE');
            } else {
                if (state.pipeSource.id === hoveredEntity.id) {
                    state.pipeSource = null;
                    return;
                }
                const result = factory.connect(state.pipeSource, hoveredEntity);
                if (result.ok) { addXp(20); saveGame(false); }
                else toast(result.reason, 'warn', 'LOGISTIQUE');
                state.pipeSource = null;
            }
            return;
        }

        if (state.selectedTool === 0) {
            if (hoveredEntity && hoveredEntity.kind === 'node') {
                mineNode(true);
            } else if (hoveredEntity && hoveredEntity.kind === 'building') {
                PP.UI.renderMachine(hoveredEntity);
            } else if (hoveredEntity && hoveredEntity.kind === 'poi') {
                inspectPoi(hoveredEntity);
            } else if (hoveredEntity && hoveredEntity.kind === 'relic') {
                collectRelic(hoveredEntity);
            }
        }
    }

    function mineNode(manual) {
        if (!hoveredEntity || hoveredEntity.kind !== 'node' || hoveredEntity.stock <= 0) return;
        if (mineCooldown > 0) return;
        const node = hoveredEntity;
        const taken = world.consumeNode(node, 1);
        if (taken <= 0) { toast('Ce gisement est épuisé.', 'warn', 'EXTRACTION'); return; }
        const bonusOre = Math.random() < difficultyProfile().yield ? 1 : 0;
        state.inventory[node.resourceType] = (state.inventory[node.resourceType] || 0) + taken + bonusOre;
        state.stats.mined += taken + bonusOre;
        if (node.resourceType === 'xenoMatter') state.stats.xenoMined = (state.stats.xenoMined || 0) + taken;
        addXp(2);
        mineCooldown = 0.34;
        miningBeamTimer = 0.12;
        PP.Audio.mine();
        if (node.stock <= 0) {
            toast(`Filon de ${D.RESOURCES[node.resourceType].name} épuisé.`, 'info', 'EXTRACTION');
        }
        updateHUDNow();
    }

    function cutTether() {
        state.tethered = false;
        if (world.weaver) world.weaver.tethered = false;
        world.silkLine.visible = false;
        document.getElementById('tether-warning').classList.remove('show');
        PP.Audio.cut();
        toast('Bio-câble tranché au découpeur plasma. Le Tisserand recule.', 'success', 'SURVIE');
        addXp(25);
    }

    function fireArc() {
        if (arcCooldown > 0) return;
        arcCooldown = 1.0;
        PP.Audio.arc();
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const start = camera.position.clone().addScaledVector(dir, 1.2);
        start.y -= 0.5;
        let end = camera.position.clone().addScaledVector(dir, 32);
        let hit = false;
        if (world.weaver) {
            const w = world.weaver;
            const toWeaver = w.group.position.clone().sub(camera.position);
            const distance = toWeaver.length();
            const angle = dir.angleTo(toWeaver.normalize());
            if (distance < 48 && angle < 0.65) {
                hit = true;
                end = w.group.position.clone();
                w.stun = 9;
                w.cooldown = 6;
                w.tethered = false;
                w.group.position.addScaledVector(toWeaver.normalize(), 16);
                state.tethered = false;
                world.silkLine.visible = false;
                document.getElementById('tether-warning').classList.remove('show');
                state.stats.weaverRepels = (state.stats.weaverRepels || 0) + 1;
                state.stats.won = state.gameWon ? 1 : state.stats.won;
                addXp(120);
                toast('Décharge électrostatique ! Le Tisserand abyssal est étourdi et recule.', 'xeno', 'COMBAT');
                PP.Audio.weaver();
                unlockCodex('fauna-abyssalWeaver');
            }
        }
        const positions = arcLine.geometry.attributes.position.array;
        positions[0] = start.x; positions[1] = start.y; positions[2] = start.z;
        positions[3] = end.x; positions[4] = end.y; positions[5] = end.z;
        arcLine.geometry.attributes.position.needsUpdate = true;
        arcLine.material.opacity = hit ? 1 : 0.45;
        arcLine.visible = true;
        arcTimer = 0.22;
        if (!hit) toast('Décharge d\'arc dissipée dans l\'eau.', 'info', 'COMBAT');
    }

    function interactHovered() {
        if (state.tethered) { cutTether(); return; }
        if (!hoveredEntity) return;
        if (hoveredEntity.kind === 'building') {
            PP.UI.renderMachine(hoveredEntity);
        } else if (hoveredEntity.kind === 'poi') {
            inspectPoi(hoveredEntity);
        } else if (hoveredEntity.kind === 'relic') {
            collectRelic(hoveredEntity);
        } else if (hoveredEntity.kind === 'vent') {
            toast('Cheminée hydrothermale active. Posez une prise géothermique à proximité pour obtenir +70 MW.', 'info', 'ÉNERGIE');
        } else if (hoveredEntity.kind === 'node') {
            toast(`${D.RESOURCES[hoveredEntity.resourceType].name} · réserve ${hoveredEntity.stock} / ${hoveredEntity.maxStock}.`, 'info', 'GÉOLOGIE');
        }
    }

    function inspectPoi(poi) {
        if (!poi) return;
        if (!state.discoveredPois[poi.id]) discoverPoi(poi);
        if (poi.codex) {
            unlockCodex(poi.codex);
            PP.UI.openCodex();
            // Force the correct category in the UI
            const tab = document.querySelector(`#codex-tabs [data-tab="structure"]`);
            if (tab) tab.click();
            const entryBtn = document.querySelector(`[data-codex="${poi.codex}"]`);
            if (entryBtn) entryBtn.click();
        } else {
            toast(poi.desc, 'info', poi.name);
        }
    }

    function dismantleHovered() {
        if (!hoveredEntity || hoveredEntity.kind !== 'building') {
            toast('Visez un module construit pour le démonter.', 'info', 'CHANTIER');
            return;
        }
        if (hoveredEntity.type === 'hub') {
            toast('La capsule principale ne peut pas être démontée.', 'warn', 'CHANTIER');
            return;
        }
        factory.dismantle(hoveredEntity);
        addXp(8);
        updateHUDNow();
    }

    /* ------------------------------------------------------------------ */
    /* DÉCOUVERTES & PROGRESSION                                           */
    /* ------------------------------------------------------------------ */
    function updateDiscovery(dt) {
        discoveryAccumulator += dt;
        if (discoveryAccumulator < 0.4) return;
        discoveryAccumulator = 0;

        const region = world.regionAt(camera.position.x, camera.position.z);
        if (region.id !== 'rift' && !state.visitedRegions[region.id]) {
            state.visitedRegions[region.id] = true;
            state.stats.regionsFound = Object.keys(state.visitedRegions).length;
            unlockCodex(`region-${region.id}`, true);
            addXp(70);
            toast(`Région découverte : ${region.full}. ${region.desc}`, 'success', 'CARTOGRAPHIE');
            PP.UI.updateMenu();
            saveGame(false);
        }

        // Secret photographique : l'efflorescence de la canopée ne se révèle
        // qu'en mode photo. Elle donne un souffle d'oxygène et une archive.
        if (!state.codex['phenomenon-biolum'] && state.photoMode && region.id === 'kelp' && world.depthOf(camera.position.y) < 320) {
            unlockCodex('phenomenon-biolum', true);
            state.o2 = Math.min(state.maxO2, state.o2 + 12);
            PP.Audio.relic();
            toast('Efflorescence bioluminescente capturée : +12 s O₂, archive ajoutée au codex.', 'xeno', 'PHOTO');
            updateHUDNow();
            saveGame(false);
        }

        const nearPoi = world.nearestPoi(camera.position);
        if (nearPoi.poi && nearPoi.distance < 34 && !state.discoveredPois[nearPoi.poi.id]) {
            discoverPoi(nearPoi.poi);
        }

        const species = world.nearestSpecies(camera.position);
        if (species) {
            const codexId = `fauna-${species}`;
            if (!state.codex[codexId]) {
                unlockCodex(codexId, true);
                addXp(45);
                toast(`Espèce enregistrée dans le codex : ${D.FAUNA[species].name}.`, 'xeno', 'XÉNO-BIOLOGIE');
            }
        }

        // Éclats de mémoire : un écho discret signale leur proximité sans
        // révéler leur position exacte sur la carte avant collecte.
        if (world.relics) {
            world.relics.forEach(relic => {
                if (relic.collected || relicPinged[relic.id]) return;
                const d = relic.position.distanceTo(camera.position);
                if (d < 82) {
                    relicPinged[relic.id] = true;
                    unlockCodex(relic.codex, true);
                    PP.Audio.relic();
                    toast(`Écho de mémoire détecté à ${Math.round(d)} m. Cherchez une lumière violette.`, 'xeno', 'RELIQUE');
                }
            });
        }

        const depth = world.depthOf(camera.position.y);
        if (depth > 500) unlockCodex('phenomenon-current');
        if (depth > 1800) unlockCodex('phenomenon-xeno');
        if (depth > 1900) unlockCodex('phenomenon-pressure');
        if ((state.stats.ventThermals || 0) > 0) unlockCodex('phenomenon-thermal');
        if (state.unlockedTechs.orbitalProtocol) unlockCodex('phenomenon-beacon', true);
    }

    function discoverPoi(poi) {
        if (!poi || state.discoveredPois[poi.id]) return;
        state.discoveredPois[poi.id] = true;
        state.stats.poiFound = Object.keys(state.discoveredPois).length;
        if (poi.codex) unlockCodex(poi.codex);
        Object.entries(poi.reward || {}).forEach(([key, value]) => {
            if (D.RESOURCES[key]) state.inventory[key] = (state.inventory[key] || 0) + value;
        });
        poi.discovered = true;
        if (poi.marker) poi.marker.material.opacity = 0.9;
        addXp(130);
        PP.Audio.pickup();
        toast(`${poi.name} · archive et ressources récupérées.`, 'success', 'DÉCOUVERTE');
        PP.UI.updateMenu();
        saveGame(false);
    }

    function collectRelic(relic) {
        if (!relic || state.relics[relic.id]) return;
        if (!world.collectRelic(relic)) return;
        state.relics[relic.id] = true;
        state.stats.relicsFound = Object.keys(state.relics).length;
        Object.entries(relic.cache || {}).forEach(([key, value]) => {
            if (D.RESOURCES[key]) state.inventory[key] = (state.inventory[key] || 0) + value;
        });
        unlockCodex(relic.codex, true);
        addXp(180);
        applyRelicEffects();
        PP.Audio.relic();
        toast(`${relic.name} recueilli · ${relic.bonus} permanent. Archive ajoutée au codex.`, 'xeno', 'MÉMOIRE');
        updateHUDNow();
        PP.UI.updateMenu();
        saveGame(false);
    }

    function unlockCodex(id, silent) {
        if (!id || !D.CODEX_BY_ID[id] || state.codex[id]) return false;
        state.codex[id] = true;
        addXp(20);
        if (!silent) {
            toast(`Codex : ${D.CODEX_BY_ID[id].title}`, 'xeno', 'ARCHIVE');
        }
        return true;
    }

    function addXp(amount) {
        if (!amount) return;
        const previous = PP.UI && PP.UI.rankInfo ? PP.UI.rankInfo(state.xp).level : 1;
        state.xp += amount;
        const next = PP.UI && PP.UI.rankInfo ? PP.UI.rankInfo(state.xp).level : 1;
        if (next > previous) {
            PP.Audio.levelUp();
            toast(`Rang d'expédition supérieur : niveau ${next}.`, 'success', 'PROGRESSION');
        }
    }

    function addRewards(reward) {
        Object.entries(reward || {}).forEach(([key, value]) => {
            if (!D.RESOURCES[key]) return;
            state.inventory[key] = (state.inventory[key] || 0) + value;
        });
    }

    /* ------------------------------------------------------------------ */
    /* CONTRATS DE LA COLONIE                                             */
    /* ------------------------------------------------------------------ */
    function contractTier() {
        if (state.unlockedTechs.hullMk4) return 3;
        if (state.unlockedTechs.hullMk3) return 2;
        if (state.unlockedTechs.hullMk2) return 1;
        return 0;
    }

    function ensureContracts() {
        if (!Array.isArray(state.contracts)) state.contracts = [];
        state.contracts = state.contracts.filter(c => c && D.RESOURCES[c.key] && Number.isFinite(c.qty) && c.qty > 0);
        const used = new Set(state.contracts.map(c => c.key));
        const tier = contractTier();
        const pool = D.CONTRACT_TEMPLATES.filter(t => t.tier <= tier && !used.has(t.key));
        while (state.contracts.length < 3 && pool.length > 0) {
            const template = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
            const done = state.stats.contractsDone || 0;
            const scale = 1 + Math.min(1.2, done * 0.05);
            const reward = {};
            Object.entries(template.reward || {}).forEach(([key, value]) => {
                reward[key] = Math.max(1, Math.round(value * (1 + Math.floor(done / 5) * 0.4)));
            });
            state.contracts.push({
                id: 'ct' + (state.nextContractId++),
                key: template.key,
                qty: Math.max(1, Math.round(template.qty * scale)),
                name: template.name,
                client: template.client,
                tier: template.tier,
                reward,
                xp: Math.round(template.xp * (1 + Math.floor(done / 5) * 0.25))
            });
        }
    }

    function deliverContract(id) {
        const index = state.contracts.findIndex(c => c.id === id);
        if (index < 0) return false;
        const contract = state.contracts[index];
        if ((state.inventory[contract.key] || 0) < contract.qty) {
            PP.Audio.error();
            toast(`Contrat incomplet : ${contract.qty} ${D.RESOURCES[contract.key].name} requis.`, 'warn', 'CONTRAT');
            return false;
        }
        state.inventory[contract.key] -= contract.qty;
        addRewards(contract.reward);
        addXp(contract.xp || 120);
        state.stats.contractsDone = (state.stats.contractsDone || 0) + 1;
        state.contracts.splice(index, 1);
        ensureContracts();
        PP.Audio.contract();
        toast(`Contrat honoré : ${contract.name}. ${Object.entries(contract.reward).map(([k, v]) => `+${v} ${D.RESOURCES[k].short}`).join(' · ')} · +${contract.xp} XP.`, 'success', 'COLONIE');
        updateHUDNow();
        if (PP.UI) { PP.UI.renderJournal(); PP.UI.updateMenu(); }
        saveGame(false);
        return true;
    }

    function completeMission(type, mission) {
        if (type === 'main') {
            if (state.completedMain.includes(mission.id)) return;
            state.completedMain.push(mission.id);
        } else {
            if (state.completedSide.includes(mission.id)) return;
            state.completedSide.push(mission.id);
        }
        addRewards(mission.reward);
        addXp(mission.xp || 50);
        PP.Audio.scan();
        toast(`Mission accomplie : ${mission.name}. Récompense versée à la capsule.`, 'success', 'MISSION');
        PP.UI.renderJournal();
        PP.UI.updateMenu();
        saveGame(false);
    }

    function updateMissions(dt) {
        missionAccumulator += dt;
        if (missionAccumulator < 0.5) return;
        missionAccumulator = 0;

        for (let guard = 0; guard < 3; guard++) {
            let active = null;
            for (const mission of D.MAIN_MISSIONS) {
                if (!state.completedMain.includes(mission.id)) { active = mission; break; }
            }
            if (!active) break;
            const track = PP.UI.getTrack(active);
            if (track.cur >= track.max) completeMission('main', active);
            else break;
        }

        for (const mission of D.SIDE_MISSIONS) {
            if (state.completedSide.includes(mission.id)) continue;
            const track = PP.UI.getTrack(mission);
            if (track.max > 0 && track.cur >= track.max) completeMission('side', mission);
        }

        if (state.gameWon && !state.completedMain.includes('m8')) {
            const m8 = D.MAIN_MISSIONS.find(m => m.id === 'm8');
            if (m8) completeMission('main', m8);
        }
    }

    function updateAchievements(dt) {
        achievementAccumulator += dt;
        if (achievementAccumulator < 1.2) return;
        achievementAccumulator = 0;
        if (state.gameWon) state.stats.won = 1;
        state.stats.regionsFound = Object.keys(state.visitedRegions).length;
        state.stats.poiFound = Object.keys(state.discoveredPois).length;
        D.ACHIEVEMENTS.forEach(ach => {
            if (state.achievements[ach.id]) return;
            const value = state.stats[ach.stat] || 0;
            if (value >= ach.goal) {
                state.achievements[ach.id] = true;
                addXp(60);
                toast(`Exploit débloqué : ${ach.name}.`, 'success', 'EXPLOIT');
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /* LÉVIATHAN                                                           */
    /* ------------------------------------------------------------------ */
    function updateWeaver(dt) {
        const w = world.weaver;
        if (!w) return;
        const player = camera.position;
        const distance = w.group.position.distanceTo(player);
        if (w.cooldown > 0) w.cooldown -= dt;

        if (w.stun > 0) {
            w.stun -= dt;
            if (state.tethered) { state.tethered = false; world.silkLine.visible = false; document.getElementById('tether-warning').classList.remove('show'); }
            w.group.position.y += Math.sin(elapsed * 2) * dt * 0.6;
            return;
        }

        const drills = state.buildings.filter(b => b.type === 'drill').length;
        const baseRange = 52 + drills * 5;
        const aggroRange = baseRange * (state.stealthFactor || 1);
        const playerDepth = world.depthOf(player.y);
        const canAggro = playerDepth > 480;

        if (canAggro && distance < aggroRange) {
            if (!state.stats.weaverSeen) {
                state.stats.weaverSeen = 1;
                unlockCodex('fauna-abyssalWeaver', true);
                toast('Signature léviathan confirmée. Le Tisserand abyssal vous a détecté.', 'danger', 'DANGER');
            }
            const dir = player.clone().sub(w.group.position);
            dir.y *= 0.45;
            dir.normalize();
            w.group.position.addScaledVector(dir, dt * 8.5);
            w.group.lookAt(player);
            PP.Audio.setDanger(U.clamp(1 - distance / aggroRange, 0.2, 1));
            if (distance < 19 && !state.tethered && w.cooldown <= 0) {
                state.tethered = true;
                w.tethered = true;
                w.cooldown = 16;
                document.getElementById('tether-warning').classList.add('show');
                PP.Audio.weaver();
                toast('Le Tisserand a projeté un bio-câble ! Tranchez-le avec [1] ou repoussez-le avec [9].', 'danger', 'SURVIE');
                saveGame(false);
            }
        } else {
            const center = w.patrolCenter;
            const px = center.x + Math.cos(elapsed * 0.09) * 120;
            const pz = center.z + Math.sin(elapsed * 0.07) * 90;
            const target = new THREE.Vector3(px, Math.max(world.height(px, pz) + 20, center.y), pz);
            const dir = target.sub(w.group.position);
            if (dir.length() > 2) {
                dir.normalize();
                w.group.position.addScaledVector(dir, dt * 5.5);
                w.group.lookAt(w.group.position.clone().add(dir));
            }
            PP.Audio.setDanger(U.clamp(0.25 - distance / 600, 0, 0.25));
        }

        if (state.tethered) {
            world.silkLine.visible = true;
            const positions = world.silkLine.geometry.attributes.position.array;
            positions[0] = w.group.position.x;
            positions[1] = w.group.position.y;
            positions[2] = w.group.position.z;
            positions[3] = player.x;
            positions[4] = player.y - 0.7;
            positions[5] = player.z;
            world.silkLine.geometry.attributes.position.needsUpdate = true;

            const pullDir = w.group.position.clone().sub(player).normalize();
            camera.position.addScaledVector(pullDir, dt * 2.6);
            state.hull = Math.max(0, state.hull - dt * 4.5 * (1 - state.hullResist));
            const damage = document.getElementById('damage-overlay');
            if (damage) damage.style.opacity = '0.35';
            if (distance > 38) {
                state.tethered = false;
                world.silkLine.visible = false;
                document.getElementById('tether-warning').classList.remove('show');
                toast('Le bio-câble s\'est rompu sous la tension.', 'warn', 'SURVIE');
            }
        } else {
            world.silkLine.visible = false;
        }
    }

    /* ------------------------------------------------------------------ */
    /* VISUELS & AMBIANCE                                                  */
    /* ------------------------------------------------------------------ */
    function updateVisuals(dt) {
        if (state.sonarCooldown > 0) state.sonarCooldown = Math.max(0, state.sonarCooldown - dt);
        if (mineCooldown > 0) mineCooldown = Math.max(0, mineCooldown - dt);
        if (arcCooldown > 0) arcCooldown = Math.max(0, arcCooldown - dt);

        const sonarBtn = document.getElementById('btn-sonar');
        if (sonarBtn) {
            sonarBtn.textContent = state.sonarCooldown > 0 ? `◉ SONAR ${state.sonarCooldown.toFixed(1)}s` : '◉ SONAR [F]';
            sonarBtn.classList.toggle('disabled', state.sonarCooldown > 0);
        }

        if (sonarMesh && sonarMesh.visible) {
            const max = sonarMesh.userData.maxScale || 40;
            sonarMesh.scale.x += dt * (max / 1.8);
            sonarMesh.scale.z = sonarMesh.scale.x;
            sonarMat.opacity = Math.max(0, 0.75 * (1 - sonarMesh.scale.x / max));
            if (sonarMesh.scale.x >= max) sonarMesh.visible = false;
        }

        if (laserLine) {
            if (miningBeamTimer > 0) {
                miningBeamTimer -= dt;
                const node = hoveredEntity && hoveredEntity.kind === 'node' ? hoveredEntity : null;
                if (node) {
                    const dir = new THREE.Vector3();
                    camera.getWorldDirection(dir);
                    const start = camera.position.clone().addScaledVector(dir, 1.1); start.y -= 0.55;
                    const end = node.position.clone(); end.y += 1.2;
                    const positions = laserLine.geometry.attributes.position.array;
                    positions[0] = start.x; positions[1] = start.y; positions[2] = start.z;
                    positions[3] = end.x; positions[4] = end.y; positions[5] = end.z;
                    laserLine.geometry.attributes.position.needsUpdate = true;
                    laserLine.visible = true;
                    laserLine.material.opacity = 0.5 + Math.random() * 0.5;
                }
            } else {
                laserLine.visible = false;
            }
        }

        if (arcLine && arcTimer > 0) {
            arcTimer -= dt;
            arcLine.material.opacity = Math.max(0, arcTimer / 0.22);
            if (arcTimer <= 0) arcLine.visible = false;
        }

        if (waypointGroup) {
            if (state.waypoint) {
                waypointGroup.visible = true;
                waypointGroup.position.set(state.waypoint.x, world.height(state.waypoint.x, state.waypoint.z), state.waypoint.z);
            } else {
                waypointGroup.visible = false;
            }
        }

        if (state.mouseDown && state.isPlaying && !state.isPaused && !PP.UI.anyModalOpen() && state.selectedTool === 0 && !state.tethered) {
            if (hoveredEntity && hoveredEntity.kind === 'node') mineNode(true);
        }
    }

    function updateSceneMood(dt) {
        if (!world) return;
        const region = world.regionAt(camera.position.x, camera.position.z);
        if (region.id !== lastRegionId) {
            lastRegionId = region.id;
            PP.Audio.setRegion(region);
        }
        const preset = qualityPreset();
        const depth = world.depthOf(camera.position.y);
        const depthFactor = U.clamp(depth / 2200, 0, 1);
        // Extinction de la lumière solaire dans la colonne d'eau : à 350 m il
        // ne reste qu'un tiers de l'éclairement de surface, à 1 000 m presque
        // rien. Sans cela, un fond à 100 m et un fond à 900 m se ressemblaient.
        const extinction = Math.exp(-depth / 620);
        const deepInk = new THREE.Color(0x01070e);
        const targetBg = new THREE.Color(region.fog)
            .lerp(deepInk, Math.min(0.88, depthFactor * 0.85))
            .lerp(new THREE.Color(region.accent), depthFactor * 0.03);
        const targetFog = region.fogDensity * preset.fog * (0.60 + depthFactor * 0.55);
        scene.background.lerp(targetBg, Math.min(1, dt * 1.6));
        scene.fog.color.lerp(targetBg, Math.min(1, dt * 1.6));
        scene.fog.density += (targetFog - scene.fog.density) * Math.min(1, dt * 1.8);

        const accent = new THREE.Color(region.accent);
        const skyTint = new THREE.Color(region.lightTop).lerp(new THREE.Color(0x2a6f92), 0.55);
        hemi.color.lerp(skyTint, Math.min(1, dt * 1.4));
        hemi.groundColor.lerp(new THREE.Color(region.lightBottom), Math.min(1, dt * 1.4));
        hemi.intensity += ((0.14 + region.lightIntensity * 0.30 * extinction) - hemi.intensity) * Math.min(1, dt * 1.4);
        const sunTint = new THREE.Color(region.lightTop)
            .lerp(new THREE.Color(0xffd9a8), 0.28 * (1 - depthFactor * 0.8));
        dir.color.lerp(sunTint, Math.min(1, dt * 1.4));
        dir.intensity += ((0.18 + region.lightIntensity * 0.90 * extinction) - dir.intensity) * Math.min(1, dt * 1.4);
        ambient.intensity += ((0.08 + 0.05 * extinction + depthFactor * 0.12) - ambient.intensity) * Math.min(1, dt * 1.4);
        ambient.color.lerp(new THREE.Color(0x0b2231).lerp(accent, 0.16), Math.min(1, dt * 1.2));
        if (rim) {
            rim.color.lerp(accent, Math.min(1, dt * 1.4));
            rim.intensity += ((0.06 + region.lightIntensity * 0.22 * extinction) - rim.intensity) * Math.min(1, dt * 1.4);
        }

        // Le projecteur reste un cône de survie lisible ; la lumière d'accent
        // révèle la flore et les reliefs sans uniformiser la scène.
        if (headlamp) {
            headlamp.intensity = 1.15 + depthFactor * 1.35;
            headlamp.distance = 52 + depthFactor * 26;
        }
        if (accentLight) {
            accentLight.color.lerp(accent, Math.min(1, dt * 1.6));
            accentLight.intensity += ((0.12 + depthFactor * 0.95) - accentLight.intensity) * Math.min(1, dt * 1.4);
            accentLight.distance = 48 + depthFactor * 30;
            const forward = new THREE.Vector3();
            camera.getWorldDirection(forward);
            accentLight.position.copy(camera.position).addScaledVector(forward, 14);
            accentLight.position.y += 6;
        }
        if (renderer) {
            // Le menu profite d'un léger surcroît d'exposition : la scène
            // d'accueil doit rester lisible derrière le panneau, pas noire.
            const menuBoost = state.isPlaying ? 0 : 0.20;
            const targetExposure = 1.10 + depthFactor * 0.12 + menuBoost;
            renderer.toneMappingExposure += (targetExposure - renderer.toneMappingExposure) * Math.min(1, dt * 1.2);
        }
        if (bloomPass) {
            const baseBloom = state.settings.quality === 'ultra' ? 0.24 : 0.19;
            bloomPass.strength = baseBloom + depthFactor * 0.14;
            bloomPass.threshold = 0.82 - depthFactor * 0.05;
        }
        if (gradePass) {
            const hullRatio = U.clamp((state.hull || 0) / 100, 0, 1);
            const damage = 1 - hullRatio;
            gradePass.uniforms.uTime.value = elapsed;
            gradePass.uniforms.uDamage.value = damage;
            gradePass.uniforms.uAberration.value = 0.0009 + damage * 0.0034;
            gradePass.uniforms.uVignette.value = 0.14 + damage * 0.20;
            gradePass.uniforms.uGrain.value = 0.021 + depthFactor * 0.012;
        }

        if (state.settings.quality !== 'low') {
            dir.position.set(camera.position.x + 120, camera.position.y + 300, camera.position.z + 100);
            dir.target.position.set(camera.position.x, camera.position.y - 120, camera.position.z);
            if (rim) {
                rim.position.set(camera.position.x - 220, camera.position.y + 160, camera.position.z - 260);
                rim.target.position.copy(camera.position);
            }
        }
    }

    function updateAudio(dt) {
        if (!PP.Audio.ready) return;
        PP.Audio.update(dt);
    }

    /* ------------------------------------------------------------------ */
    /* CONTRÔLES DE JEU                                                    */
    /* ------------------------------------------------------------------ */
    function selectTool(index) {
        if (index < 0 || index > 8) return;
        if (index === 0 || index === 8) {
            state.selectedTool = index;
            state.currentBuild = null;
            if (factory) factory.endGhost();
        } else {
            const def = D.BUILD_BY_SLOT[index];
            if (!def) return;
            if (def.tech && !state.unlockedTechs[def.tech]) {
                PP.Audio.error();
                toast(`Schéma verrouillé. Débloquez « ${D.TECH_BY_ID[def.tech].name} » dans la recherche [T].`, 'warn', 'CHANTIER');
                return;
            }
            state.selectedTool = index;
            state.currentBuild = def.type;
            if (factory) {
                factory.beginGhost(def.type);
                factory.ghost.visible = false;
            }
        }
        state.pipeSource = null;
        PP.Audio.click();
        updateHUDNow();
    }

    function selectBuildType(type) {
        const def = D.BUILDINGS[type];
        if (!def) return;
        if (def.tech && !state.unlockedTechs[def.tech]) {
            PP.Audio.error();
            toast(`Schéma verrouillé : ${D.TECH_BY_ID[def.tech].name}.`, 'warn', 'CHANTIER');
            return;
        }
        state.currentBuild = type;
        state.lastBuildType = type;
        state.selectedTool = -1;
        state.pipeSource = null;
        if (factory) {
            factory.beginGhost(type);
            factory.ghost.visible = false;
        }
        PP.Audio.click();
        toast(`Module sélectionné : ${def.name}. Visez le sol et cliquez pour poser.`, 'info', 'CHANTIER');
        updateHUDNow();
    }

    function useSonar() {
        if (!state.isPlaying || state.isPaused) return;
        if (state.sonarCooldown > 0) {
            toast(`Sonar en recharge : ${state.sonarCooldown.toFixed(1)} s.`, 'info', 'SONAR');
            return;
        }
        const boost = state.unlockedTechs.sonarBoost ? 2 : 1;
        const range = 92 * boost * (1 + (state.relicBuffs.scan || 0));
        state.sonarCooldown = state.unlockedTechs.sonarBoost ? 6 : 8;
        state.stats.sonarUses = (state.stats.sonarUses || 0) + 1;
        PP.Audio.sonar();
        unlockCodex('phenomenon-sonar', true);

        if (sonarMesh) {
            sonarMesh.visible = true;
            sonarMesh.position.copy(camera.position).add(new THREE.Vector3(0, -0.7, 0));
            sonarMesh.scale.set(1, 1, 1);
            const maxScale = range / 1.35;
            sonarMesh.userData.maxScale = maxScale;
            sonarMat.opacity = 0.75;
        }

        let found = 0;
        world.nodes.forEach((node, index) => {
            if (node.stock > 0 && node.position.distanceTo(camera.position) < range) {
                if (!state.discoveredNodes.includes(index)) {
                    state.discoveredNodes.push(index);
                    found++;
                }
            }
        });
        (world.salvage || []).forEach(cache => {
            if (!cache.collected && !cache.revealed && cache.position.distanceTo(camera.position) < range * 1.35) {
                cache.revealed = true;
                found++;
            }
        });
        toast(`Impulsion sonar : ${found} nouvelle(s) signature(s) — filons et épaves — dans un rayon de ${Math.round(range)} m.`, 'info', 'SONAR');
        addXp(8);
        updateHUDNow();
    }

    function setWaypoint(x, z, label) {
        state.waypoint = {
            x: U.clamp(Math.round(x), -W.HALF, W.HALF),
            z: U.clamp(Math.round(z), -W.HALF, W.HALF),
            label: label || 'Balise'
        };
        updateHUDNow();
    }

    function clearWaypoint() {
        state.waypoint = null;
        updateHUDNow();
    }

    function trackMission(id) {
        const mission = D.MAIN_MISSIONS.find(m => m.id === id);
        const target = mission && mission.target;
        if (!mission || !target) {
            toast('Aucun repère cartographique disponible pour cet objectif.', 'info', 'MISSION');
            return false;
        }
        let x = 0, z = 0;
        let label = target.label || mission.name;
        if (target.region && D.REGION_BY_ID[target.region]) {
            x = D.REGION_BY_ID[target.region].center[0];
            z = D.REGION_BY_ID[target.region].center[1];
        } else if (target.poi && D.POI_BY_ID[target.poi]) {
            x = D.POI_BY_ID[target.poi].x;
            z = D.POI_BY_ID[target.poi].z;
        } else if (target.hub) {
            const hub = state.buildings.find(b => b.type === 'hub');
            if (hub) { x = hub.position.x; z = hub.position.z; }
        } else {
            toast('Aucun repère cartographique disponible pour cet objectif.', 'info', 'MISSION');
            return false;
        }
        setWaypoint(x, z, label);
        saveGame(false);
        PP.Audio.pickup();
        toast(`Objectif suivi : ${label}. La balise est tracée sur la carte et la boussole.`, 'success', 'MISSION');
        return true;
    }

    function machineAction(action, b) {
        if (!b) return;
        if (action === 'repair') {
            if (state.hull >= 100) { toast('La coque est déjà intacte.', 'info', 'SURVIE'); return; }
            if ((state.inventory.bioGel || 0) < 1) { PP.Audio.error(); toast('1 biogel réparateur requis.', 'warn', 'SURVIE'); return; }
            state.inventory.bioGel -= 1;
            state.hull = 100;
            PP.Audio.craft();
            toast('Coque entièrement réparée.', 'success', 'SURVIE');
        } else if (action === 'refill') {
            state.o2 = state.maxO2;
            PP.Audio.pickup();
            toast('Réserves d\'oxygène rechargées.', 'success', 'SURVIE');
        } else if (action === 'upgrade') {
            const result = factory.upgrade(b);
            if (!result.ok) {
                PP.Audio.error();
                toast(result.reason, 'warn', 'AMÉLIORATION');
            } else {
                addXp(45);
                updateHUDNow();
                saveGame(false);
            }
        } else if (action === 'locate-node') {
            const node = Number.isInteger(b.linkedNodeId) ? world.nodes[b.linkedNodeId] : null;
            if (node) {
                setWaypoint(node.position.x, node.position.z, 'Filon de ' + D.RESOURCES[node.resourceType].name);
                PP.UI.closeModal('modal-machine');
                toast('Balise de navigation posée sur le gisement.', 'info', 'NAVIGATION');
            }
        }
        updateHUDNow();
    }

    function buyTech(id) {
        const tech = D.TECH_BY_ID[id];
        if (!tech || state.unlockedTechs[id]) return;
        const missing = (tech.requires || []).filter(req => !state.unlockedTechs[req]);
        if (missing.length) {
            PP.Audio.error();
            toast(`Prérequis manquants : ${missing.map(r => D.TECH_BY_ID[r].name).join(' · ')}.`, 'warn', 'RECHERCHE');
            return;
        }
        if (!hasCost(tech.cost)) {
            PP.Audio.error();
            toast('Ressources insuffisantes pour cette recherche.', 'warn', 'RECHERCHE');
            return;
        }
        factory.pay(tech.cost);
        state.unlockedTechs[id] = true;
        applyTechEffects();
        addXp(90);
        PP.Audio.build();
        PP.Audio.levelUp();
        toast(`Recherche terminée : ${tech.name}.`, 'success', 'RECHERCHE');
        PP.UI.renderTech();
        PP.UI.updateMenu();
        updateHUDNow();
        saveGame(false);
    }

    function craft(recipeId, requested = 1) {
        const recipe = D.HAND_RECIPES.find(r => r.id === recipeId);
        if (!recipe) return;
        if (recipe.tech && !state.unlockedTechs[recipe.tech]) {
            PP.Audio.error();
            toast('Recherche nécessaire pour fabriquer cet objet.', 'warn', 'FABRICATION');
            return;
        }
        if (!hasCost(recipe.cost)) {
            PP.Audio.error();
            toast('Matières premières insuffisantes.', 'warn', 'FABRICATION');
            return;
        }
        let count = Math.max(1, Math.floor(requested || 1));
        if (count > 1) {
            count = Math.min(count, ...Object.entries(recipe.cost).map(([key, value]) => Math.floor((state.inventory[key] || 0) / value)));
        }
        count = Math.max(1, count);
        Object.entries(recipe.cost).forEach(([key, value]) => { state.inventory[key] -= value * count; });
        Object.entries(recipe.out).forEach(([key, value]) => { state.inventory[key] = (state.inventory[key] || 0) + value * count; });
        state.stats.crafted = (state.stats.crafted || 0) + count;
        if (recipe.out.xenoCore) state.stats.xenoCoreMade = (state.stats.xenoCoreMade || 0) + recipe.out.xenoCore * count;
        addXp(6 * count);
        PP.Audio.craft();
        toast(`Fabrication ×${count} : +${Object.entries(recipe.out).map(([k, v]) => `${v * count} ${D.RESOURCES[k].name}`).join(' + ')}.`, 'success', 'FABRICATION');
        PP.UI.renderInventory();
        updateHUDNow();
    }

    function setRecipe(buildingId, recipeId) {
        const b = factory.getById(buildingId);
        if (!b) return;
        if (factory.setRecipe(b, recipeId)) {
            toast(`Recette configurée : ${D.SMELTER_RECIPES[recipeId].name}.`, 'info', 'INDUSTRIE');
        }
    }

    function dismantleBuilding(b) {
        if (!b || b.type === 'hub') return;
        factory.dismantle(b);
        addXp(8);
        updateHUDNow();
        saveGame(false);
    }

    function activateBeacon() {
        if (state.gameWon) return;
        if (!state.unlockedTechs.orbitalProtocol) {
            PP.Audio.error();
            toast('Protocole orbital non débloqué.', 'warn', 'BALISE');
            return;
        }
        if ((state.inventory.xenoCore || 0) < D.XENO_CORE_REQUIRED) {
            PP.Audio.error();
            toast(`Trois noyaux xéno stabilisés sont requis (${state.inventory.xenoCore || 0} / 3).`, 'warn', 'BALISE');
            return;
        }
        if (!hasCost(D.BEACON_EXTRA_COST)) {
            PP.Audio.error();
            toast('Composants de la balise incomplets.', 'warn', 'BALISE');
            return;
        }
        Object.entries(D.BEACON_EXTRA_COST).forEach(([key, value]) => { state.inventory[key] -= value; });
        state.inventory.xenoCore -= D.XENO_CORE_REQUIRED;
        state.gameWon = true;
        state.stats.won = 1;
        state.tethered = false;
        if (world.weaver) world.weaver.tethered = false;
        world.silkLine.visible = false;
        document.getElementById('tether-warning').classList.remove('show');
        addXp(1000);
        PP.Audio.victory();
        saveGame(false);
        PP.UI.closeAllModals();
        PP.UI.openVictory({
            depth: state.stats.maxDepth,
            regions: Object.keys(state.visitedRegions).length,
            techs: Object.keys(state.unlockedTechs).length,
            relics: Object.keys(state.relics).length,
            time: state.stats.playTime
        });
        if (document.pointerLockElement) document.exitPointerLock();
    }

    function applyRelicEffects() {
        const buffs = { speed: 0, o2: 0, hull: 0, power: 0, scan: 0, xeno: 0, stealth: 0, light: 0, craft: 0, drill: 0 };
        D.RELICS.forEach(relic => {
            if (state.relics[relic.id]) buffs[relic.buff] = (buffs[relic.buff] || 0) + relic.value;
        });
        state.relicBuffs = buffs;
        state.stats.relicsFound = Object.keys(state.relics).length;
        applyTechEffects();
    }

    function applyTechEffects() {
        const buffs = state.relicBuffs || {};
        state.maxO2 = (state.unlockedTechs.o2Mk1 ? 160 : 100) + (buffs.o2 || 0);
        const currentO2 = Number.isFinite(state.o2) ? state.o2 : state.maxO2;
        state.o2 = Math.min(state.maxO2, Math.max(0, currentO2));
        state.maxCrushDepth = state.unlockedTechs.hullMk4 ? 3200
            : state.unlockedTechs.hullMk3 ? 1900
            : state.unlockedTechs.hullMk2 ? 950 : 320;
        state.acousticStealth = !!state.unlockedTechs.acousticPlating;
        state.hullResist = U.clamp(buffs.hull || 0, 0, 0.6);
        state.stealthFactor = U.clamp(
            1 - (state.unlockedTechs.acousticPlating ? 0.45 : 0) - (buffs.stealth || 0),
            0.2, 1
        );
        state.moveSpeed = 24 * (1 + (buffs.speed || 0));
        if (headlamp) {
            headlamp.distance = 34 * (1 + (buffs.light || 0));
            headlamp.intensity = 0.8 * (1 + (buffs.light || 0) * 0.35);
        }
        if (factory) factory.recalcPower();
    }

    function dockRadius(b) {
        return 17 + ((b && b.level ? b.level : 1) - 1) * 5;
    }

    /* ------------------------------------------------------------------ */
    /* HUD / MENU / SESSION                                                */
    /* ------------------------------------------------------------------ */
    function updateHUDNow() {
        if (PP.UI) PP.UI.updateHUD();
    }

    function toast(text, type, title) {
        if (PP.UI) PP.UI.toast(text, type || 'info', title);
    }

    function hint(text) {
        toast(text, 'info', 'CONSEIL');
    }

    function spawnCamera() {
        camera.position.set(0, 12.5, 32);
        camera.lookAt(0, 8.5, 0);
        camera.rotation.z = 0;
        lookEuler.setFromQuaternion(camera.quaternion);
        velocity.set(0, 0, 0);
    }

    function applyResumeCamera() {
        if (state.resumeCamera && Array.isArray(state.resumeCamera.pos) && state.resumeCamera.pos.length === 3) {
            camera.position.fromArray(state.resumeCamera.pos);
            if (Array.isArray(state.resumeCamera.quat) && state.resumeCamera.quat.length === 4) {
                camera.quaternion.fromArray(state.resumeCamera.quat);
            }
            camera.position.y = U.clamp(camera.position.y, world.height(camera.position.x, camera.position.z) + 1.9, W.WATER_Y - 2.4);
            lookEuler.setFromQuaternion(camera.quaternion);
        } else {
            spawnCamera();
        }
    }

    function start() {
        if (starting) return;
        starting = true;
        PP.Audio.init();
        PP.Audio.resume();
        applySettings();
        PP.UI.showMenu(false);
        const dive = document.getElementById('dive-overlay');
        if (dive) {
            dive.classList.add('show');
            const sub = document.getElementById('dive-sub');
            if (sub) sub.textContent = state.loadedSave ? 'RESTAURATION DE LA SESSION' : 'NIVEAU DE PRESSION NOMINAL';
        }
        clearTimeout(diveTimer);
        diveTimer = setTimeout(() => {
            state.isPlaying = true;
            state.isPaused = false;
            state.started = true;
            applyResumeCamera();
            if (PP.UI) {
                PP.UI.setHUDVisible(true);
                PP.UI.updateHUD();
                PP.UI.updateMenu();
            }
            if (dive) dive.classList.remove('show');
            // On démarre curseur libre : les menus sont immédiatement
            // cliquables, et le premier clic dans l'océan verrouille la vue.
            starting = false;
            updateHUDNow();
            hint(state.loadedSave
                ? 'Session restaurée. Cliquez dans l\'océan pour piloter, [P] pour le menu, [H] pour les commandes.'
                : 'Cliquez dans l\'océan pour piloter et extraire. [P] menu, [H] commandes, [L] curseur libre.');
        }, 780);
    }

    function pause() {
        if (!state.isPlaying) return;
        state.isPaused = true;
        clearPressedKeys();
        if (document.pointerLockElement) document.exitPointerLock();
        PP.UI.openPauseModal();
    }

    function resume() {
        state.isPaused = false;
        requestPointerLock();
    }

    function resumeExploration() {
        state.isPaused = false;
        requestPointerLock();
        hint('Vous pouvez continuer à explorer Thalassa-IV. La colonie est autonome.');
    }

    function toMenu() {
        if (state.isPlaying) {
            state.resumeCamera = {
                pos: camera.position.toArray(),
                quat: camera.quaternion.toArray()
            };
        }
        saveGame(false);
        state.isPlaying = false;
        state.isPaused = false;
        state.mouseDown = false;
        clearPressedKeys();
        if (document.pointerLockElement) document.exitPointerLock();
        PP.UI.closeAllModals();
        PP.UI.setHUDVisible(false);
        PP.UI.showMenu(true);
        PP.UI.updateMenu();
        updateMenuLabel();
        state.started = true;
        menuAngle = 0;
    }

    function updateMenuLabel() {
        if (state.gameWon) PP.UI.setPlayLabel('⌁ Continuer l\'exploration');
        else if (state.loadedSave || state.stats.mined > 0 || state.stats.buildCount > 0) PP.UI.setPlayLabel('⌁ Reprendre l\'expédition');
        else PP.UI.setPlayLabel('⌁ Plonger sur Thalassa-IV');
    }

    function resetGame() {
        try {
            localStorage.removeItem(SAVE_KEY);
            localStorage.removeItem(SAVE_BACKUP_KEY);
        } catch (error) { /* ignore */ }
        location.reload();
    }

    /* ------------------------------------------------------------------ */
    /* PARAMÈTRES                                                          */
    /* ------------------------------------------------------------------ */
    function applySettings() {
        if (!renderer) return;
        const preset = qualityPreset();
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio));
        renderer.setSize(window.innerWidth, window.innerHeight);
        const wantBloom = !!preset.bloom;
        if (wantBloom && !composer) setupComposer();
        else if (!wantBloom && composer) disposeComposer();
        if (composer) {
            composer.setPixelRatio(renderer.getPixelRatio());
            composer.setSize(window.innerWidth, window.innerHeight);
        }
        renderer.shadowMap.enabled = !!preset.shadows;
        camera.fov = state.settings.fov;
        camera.updateProjectionMatrix();
        PP.Audio.setVolume(state.settings.master, state.settings.music, state.settings.ambience, state.settings.sfx);
        document.body.classList.toggle('scanlines', !!state.settings.scanlines);
        if (world) {
            world.quality.viewDistance = preset.viewDistance;
            world.quality.fog = preset.fog;
        }
    }

    function changeQuality() {
        applySettings();
        toast(`Qualité graphique : ${{ low: 'basse', medium: 'moyenne', high: 'haute', ultra: 'ultra' }[state.settings.quality]}.`, 'info', 'SYSTÈME');
    }

    function saveSettings() {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
        } catch (error) { /* stockage indisponible */ }
    }

    /* ------------------------------------------------------------------ */
    /* SAUVEGARDE                                                          */
    /* ------------------------------------------------------------------ */
    function serialize() {
        return {
            version: SAVE_VERSION,
            savedAt: new Date().toISOString(),
            inventory: { ...state.inventory },
            unlockedTechs: Object.keys(state.unlockedTechs),
            completedMain: [...state.completedMain],
            completedSide: [...state.completedSide],
            codex: { ...state.codex },
            achievements: { ...state.achievements },
            visitedRegions: { ...state.visitedRegions },
            discoveredPois: { ...state.discoveredPois },
            discoveredNodes: [...state.discoveredNodes],
            relics: { ...state.relics },
            contracts: state.contracts.map(c => ({ ...c, reward: { ...c.reward } })),
            depthMilestones: { ...state.depthMilestones },
            nextContractId: state.nextContractId,
            stats: { ...state.stats },
            xp: state.xp,
            settings: { ...state.settings },
            o2: state.o2,
            hull: state.hull,
            credits: state.credits,
            difficulty: state.difficulty,
            mapMarkers: state.mapMarkers,
            regionCells: state.regionCells,
            masteryClaims: state.masteryClaims,
            cacheTaken: state.cacheTaken,
            photoFilter: state.photoFilter,
            lastBuildType: state.lastBuildType,
            breach: { ...state.breach },
            maxCrushDepth: state.maxCrushDepth,
            acousticStealth: state.acousticStealth,
            waypoint: state.waypoint ? { ...state.waypoint } : null,
            player: { pos: camera.position.toArray(), quat: camera.quaternion.toArray() },
            nodes: world ? world.nodes.map(n => n.stock) : [],
            buildings: factory ? factory.serialize() : [],
            pipes: state.pipes.map(p => ({ fromId: p.fromId, toId: p.toId, carrying: p.carrying, transit: p.transit })),
            nextBuildingId: state.nextBuildingId,
            weaver: world && world.weaver ? { pos: world.weaver.group.position.toArray(), stun: world.weaver.stun } : null,
            gameWon: state.gameWon
        };
    }

    function saveGame(showFeedback = false) {
        if (!world) return false;
        try {
            const previous = localStorage.getItem(SAVE_KEY);
            if (previous) {
                try {
                    if (isValidSavePayload(JSON.parse(previous))) localStorage.setItem(SAVE_BACKUP_KEY, previous);
                } catch (backupError) { /* la sauvegarde précédente est illisible : ne pas écraser le secours */ }
            }
            localStorage.setItem(SAVE_KEY, JSON.stringify(serialize()));
            state.loadedSave = true;
            if (showFeedback) toast('Sauvegarde complète enregistrée.', 'success', 'SYSTÈME');
            const time = document.getElementById('pause-save-time');
            if (time) time.textContent = `SAUVEGARDE ${new Date().toLocaleTimeString('fr-FR')}`;
            return true;
        } catch (error) {
            console.error('Sauvegarde impossible', error);
            toast('Échec de sauvegarde : stockage local saturé ou indisponible.', 'danger', 'SYSTÈME');
            return false;
        }
    }

    function saveExists() {
        try { return !!(localStorage.getItem(SAVE_KEY) || localStorage.getItem(SAVE_BACKUP_KEY)); }
        catch (error) { return false; }
    }

    function isValidSavePayload(saved) {
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return false;
        if (!saved.inventory || typeof saved.inventory !== 'object' || Array.isArray(saved.inventory)) return false;
        if (saved.version !== undefined) {
            const version = Number(saved.version);
            if (!Number.isFinite(version) || version < 1 || version > SAVE_VERSION) return false;
        }
        return true;
    }

    function loadGame() {
        let raw, usedBackup = false;
        try {
            raw = localStorage.getItem(SAVE_KEY);
            if (!raw) {
                raw = localStorage.getItem(SAVE_BACKUP_KEY);
                usedBackup = !!raw;
            }
        } catch (error) { return false; }
        if (!raw) return false;
        try {
            let saved;
            try { saved = JSON.parse(raw); }
            catch (parseError) {
                const backup = localStorage.getItem(SAVE_BACKUP_KEY);
                if (!backup || backup === raw) throw parseError;
                saved = JSON.parse(backup);
                usedBackup = true;
            }
            if (!isValidSavePayload(saved)) {
                const backup = localStorage.getItem(SAVE_BACKUP_KEY);
                if (!backup || backup === raw) throw new Error('format de sauvegarde invalide');
                const backupSaved = JSON.parse(backup);
                if (!isValidSavePayload(backupSaved)) throw new Error('format de sauvegarde invalide');
                saved = backupSaved;
                usedBackup = true;
            }
            if (saved.inventory && typeof saved.inventory === 'object') {
                Object.keys(state.inventory).forEach(key => {
                    const value = saved.inventory[key];
                    if (Number.isFinite(value) && value >= 0) state.inventory[key] = Math.floor(value);
                });
            }
            if (Array.isArray(saved.unlockedTechs)) {
                saved.unlockedTechs.forEach(id => { if (D.TECH_BY_ID[id]) state.unlockedTechs[id] = true; });
            }
            if (Array.isArray(saved.completedMain)) state.completedMain = saved.completedMain.filter(id => D.MAIN_MISSIONS.some(m => m.id === id));
            if (Array.isArray(saved.completedSide)) state.completedSide = saved.completedSide.filter(id => D.SIDE_MISSIONS.some(m => m.id === id));
            if (saved.codex && typeof saved.codex === 'object') {
                Object.keys(saved.codex).forEach(id => { if (D.CODEX_BY_ID[id]) state.codex[id] = !!saved.codex[id]; });
            }
            if (saved.achievements && typeof saved.achievements === 'object') {
                Object.keys(saved.achievements).forEach(id => { if (D.ACHIEVEMENTS.some(a => a.id === id)) state.achievements[id] = !!saved.achievements[id]; });
            }
            if (saved.visitedRegions && typeof saved.visitedRegions === 'object') {
                Object.keys(saved.visitedRegions).forEach(id => { if (D.REGION_BY_ID[id]) state.visitedRegions[id] = true; });
            }
            if (saved.discoveredPois && typeof saved.discoveredPois === 'object') {
                Object.keys(saved.discoveredPois).forEach(id => { if (D.POI_BY_ID[id]) state.discoveredPois[id] = true; });
            }
            if (Array.isArray(saved.discoveredNodes)) {
                state.discoveredNodes = saved.discoveredNodes.filter(i => Number.isInteger(i) && i >= 0 && i < world.nodes.length);
            }
            if (saved.relics && typeof saved.relics === 'object') {
                Object.keys(saved.relics).forEach(id => {
                    if (D.RELIC_BY_ID[id] && saved.relics[id]) state.relics[id] = true;
                });
            }
            if (Array.isArray(saved.contracts)) {
                const usedContractIds = new Set();
                state.contracts = saved.contracts.filter(c => c && D.RESOURCES[c.key] && Number.isFinite(c.qty) && c.qty > 0 && c.reward && typeof c.reward === 'object').slice(0, 3).map(c => {
                    let id = typeof c.id === 'string' && /^ct\d+$/.test(c.id) && !usedContractIds.has(c.id) ? c.id : 'ct' + (state.nextContractId++);
                    usedContractIds.add(id);
                    const reward = {};
                    Object.entries(c.reward).slice(0, 8).forEach(([key, value]) => {
                        if (D.RESOURCES[key] && Number.isFinite(value) && value > 0) reward[key] = Math.min(9999, Math.floor(value));
                    });
                    return {
                        id,
                        key: c.key,
                        qty: U.clamp(Math.floor(c.qty), 1, 9999),
                        name: typeof c.name === 'string' ? c.name.slice(0, 60) : D.RESOURCES[c.key].name,
                        client: typeof c.client === 'string' ? c.client.slice(0, 60) : 'Colonie',
                        tier: U.clamp(Number.isInteger(c.tier) ? c.tier : 0, 0, 3),
                        reward,
                        xp: U.clamp(Math.floor(Number(c.xp) || 120), 0, 9999)
                    };
                }).filter(c => Object.keys(c.reward).length > 0);
            }
            if (Number.isFinite(saved.nextContractId)) state.nextContractId = Math.max(1, Math.min(100000, Math.floor(saved.nextContractId)));
            state.nextContractId = Math.max(state.nextContractId, ...state.contracts.map(c => (Number(c.id.replace(/^ct/, '')) || 0) + 1), 1);
            if (saved.stats && typeof saved.stats === 'object') {
                Object.keys(state.stats).forEach(key => {
                    if (Number.isFinite(saved.stats[key]) && saved.stats[key] >= 0) state.stats[key] = saved.stats[key];
                });
            }
            if (saved.depthMilestones && typeof saved.depthMilestones === 'object') {
                Object.keys(saved.depthMilestones).forEach(key => {
                    if (Number(saved.depthMilestones[key]) && Number.isFinite(Number(key))) state.depthMilestones[key] = true;
                });
            }
            if (Number.isFinite(saved.xp)) state.xp = Math.max(0, saved.xp);
            if (Number.isFinite(saved.credits)) state.credits = Math.max(0, Math.round(saved.credits));
            if (DIFFICULTIES[saved.difficulty]) state.difficulty = saved.difficulty;
            if (Array.isArray(saved.mapMarkers)) {
                state.mapMarkers = saved.mapMarkers.filter(m => m && Number.isFinite(m.x) && Number.isFinite(m.z)).slice(0, 8)
                    .map(m => ({
                        x: U.clamp(m.x, -W.HALF, W.HALF),
                        z: U.clamp(m.z, -W.HALF, W.HALF),
                        label: typeof m.label === 'string' ? m.label.slice(0, 42) : 'Marqueur'
                    }));
            }
            if (saved.regionCells && typeof saved.regionCells === 'object') {
                state.regionCells = {};
                Object.keys(saved.regionCells).forEach(id => {
                    if (!D.REGION_BY_ID[id] || !saved.regionCells[id] || typeof saved.regionCells[id] !== 'object') return;
                    state.regionCells[id] = {};
                    Object.keys(saved.regionCells[id]).slice(0, 4000).forEach(cell => { state.regionCells[id][cell] = 1; });
                });
            }
            if (saved.masteryClaims && typeof saved.masteryClaims === 'object') {
                state.masteryClaims = {};
                Object.keys(saved.masteryClaims).forEach(id => {
                    if (Array.isArray(saved.masteryClaims[id])) state.masteryClaims[id] = saved.masteryClaims[id].filter(v => [25, 50, 75, 100].includes(v));
                });
            }
            if (saved.cacheTaken && typeof saved.cacheTaken === 'object') {
                state.cacheTaken = { ...saved.cacheTaken };
            }
            if (Number.isFinite(saved.photoFilter)) state.photoFilter = U.clamp(saved.photoFilter, 0, 3);
            if (typeof saved.lastBuildType === 'string' && D.BUILDINGS[saved.lastBuildType]) state.lastBuildType = saved.lastBuildType;
            if (saved.breach && typeof saved.breach === 'object') state.breach = { active: !!saved.breach.active, timer: 0 };
            if (Number.isFinite(saved.o2)) state.o2 = U.clamp(saved.o2, 0, 10000);
            if (Number.isFinite(saved.hull)) state.hull = U.clamp(saved.hull, 0, 100);
            if (Number.isFinite(saved.nextBuildingId)) state.nextBuildingId = Math.max(2, Math.min(10000, saved.nextBuildingId));
            if (saved.waypoint && Number.isFinite(saved.waypoint.x) && Number.isFinite(saved.waypoint.z)) {
                state.waypoint = {
                    x: saved.waypoint.x, z: saved.waypoint.z,
                    label: typeof saved.waypoint.label === 'string' ? saved.waypoint.label.slice(0, 60) : 'Balise'
                };
            }
            state.gameWon = saved.gameWon === true;
            state.stats.won = state.gameWon ? 1 : state.stats.won;
            state.stats.regionsFound = Object.keys(state.visitedRegions).length;
            state.stats.poiFound = Object.keys(state.discoveredPois).length;
            state.stats.relicsFound = Object.keys(state.relics).length;
            applyRelicEffects();
            if (world.applyRelicState) world.applyRelicState(state.relics);
            if (world.salvage) {
                world.salvage.forEach(cache => {
                    if (state.cacheTaken && state.cacheTaken[cache.id]) {
                        cache.collected = true;
                        if (cache.group) cache.group.visible = false;
                    }
                });
            }
            applyPhotoFilter();

            if (Array.isArray(saved.nodes)) {
                saved.nodes.forEach((stock, index) => {
                    const node = world.nodes[index];
                    if (node && Number.isFinite(stock)) {
                        node.stock = Math.max(0, Math.min(node.maxStock, Math.floor(stock)));
                        if (node.stock <= 0) world.hideNodeVisual(node);
                    }
                });
            }
            if (factory) {
                factory.restore(saved.buildings || []);
                factory.restorePipes(saved.pipes || []);
            }
            if (saved.player && Array.isArray(saved.player.pos) && saved.player.pos.length === 3 && saved.player.pos.every(Number.isFinite)) {
                state.resumeCamera = {
                    pos: [
                        U.clamp(saved.player.pos[0], -W.HALF + 18, W.HALF - 18),
                        U.clamp(saved.player.pos[1], -W.MAX_DEPTH / W.DEPTH_SCALE - 20, W.WATER_Y + 20),
                        U.clamp(saved.player.pos[2], -W.HALF + 18, W.HALF - 18)
                    ],
                    quat: Array.isArray(saved.player.quat) && saved.player.quat.length === 4 && saved.player.quat.every(Number.isFinite) ? saved.player.quat : [0, 0, 0, 1]
                };
            }
            if (saved.weaver && Array.isArray(saved.weaver.pos) && saved.weaver.pos.length === 3 && saved.weaver.pos.every(Number.isFinite) && world.weaver) {
                world.weaver.group.position.fromArray(saved.weaver.pos);
            }
            if (saved.discoveredPois) {
                world.pois.forEach(p => {
                    if (state.discoveredPois[p.id]) {
                        p.discovered = true;
                        if (p.marker) p.marker.material.opacity = 0.9;
                    }
                });
            }
            state.loadedSave = true;
            ensureContracts();
            if (usedBackup) {
                toast('Sauvegarde principale illisible : la sauvegarde de secours a été restaurée.', 'warn', 'SYSTÈME');
                try { localStorage.setItem(SAVE_KEY, JSON.stringify(serialize())); } catch (restoreError) { /* secours conservé */ }
            }
            PP.UI.updateMenu();
            updateMenuLabel();
            return true;
        } catch (error) {
            console.error('Sauvegarde illisible', error);
            toast('Sauvegarde illisible ou incompatible. Une nouvelle expédition reste possible.', 'danger', 'SYSTÈME');
            return false;
        }
    }

    /* ------------------------------------------------------------------ */
    /* API PUBLIQUE                                                        */
    /* ------------------------------------------------------------------ */
    const api = {
        state, get camera() { return camera; }, get scene() { return scene; },
        get world() { return world; }, get factory() { return factory; },
        start, pause, resume, resumeExploration, toMenu, resetGame,
        selectTool, selectBuildType, getSelectedBuildingDef: currentBuildDef,
        useSonar, setWaypoint, clearWaypoint, trackMission, saveGame, saveExists, loadGame,
        applySettings, saveSettings, changeQuality,
        buyTech, craft, setRecipe, machineAction, dismantleBuilding, activateBeacon,
        deliverContract, ensureContracts, collectRelic, rerollContracts,
        fastTravel, manualRecall, useEmergencyO2, fieldRepair, toggleDepthHold,
        powerSurge, silentRunning, emergencyAscent, toggleAutoScan, autoScanPulse,
        sellResource, buyMarket, marketValue, addCredits, setDifficulty, difficultyProfile,
        cyclePhotoFilter, repeatLastBuild, addMapMarker, clearMapMarkers, revealNearby,
        updateCartography, updateOps,
        scanFauna, toggleNodeHighlight, togglePhotoMode, exportSave, importSave, quickLoad,
        get contracts() { return state.contracts; },
        requestPointerLock, hint, toast,
        get hoveredEntity() { return hoveredEntity; },
        get bootProfile() { return { ...bootTimings }; },
        renderStats() {
            if (!renderer) return null;
            const info = renderer.info;
            const sceneRender = lastSceneRender || info.render;
            let meshes = 0, visible = 0, instances = 0, lights = 0;
            scene.traverse(obj => {
                if (obj.isLight) lights++;
                if (obj.isMesh) {
                    meshes++;
                    if (obj.visible) visible++;
                    if (obj.isInstancedMesh) instances += obj.count;
                }
            });
            return {
                calls: sceneRender.calls, triangles: sceneRender.triangles,
                lines: sceneRender.lines, points: sceneRender.points,
                geometries: info.memory.geometries, textures: info.memory.textures,
                programs: info.programs ? info.programs.length : 0,
                meshes, visible, instances, lights
            };
        }
    };

    /* ------------------------------------------------------------------ */
    /* BOOT                                                                */
    /* ------------------------------------------------------------------ */
    const bootTimings = {};
    function bootMark(label, startedAt) {
        bootTimings[label] = Math.round(performance.now() - startedAt);
    }

    async function boot() {
        const bootStart = performance.now();
        readSettings();
        setupScene();
        bootMark('scene', bootStart);
        PP.UI.setBoot(0.02, 'Initialisation de la sonde');
        try {
            const worldStart = performance.now();
            world = PP.World.create(scene, qualityPreset());
            await world.buildAsync((progress, label) => PP.UI.setBoot(progress, label));
            bootMark('world', worldStart);
            PP.UI.setBoot(0.97, 'Réveil de la capsule');
            const factoryStart = performance.now();
            factory = PP.Factory.create(scene, world, state, () => camera.position);
            factory.spawnHub();
            bootMark('factory', factoryStart);
            const uiStart = performance.now();
            loadGame();
            applyRelicEffects();
            ensureContracts();
            PP.UI.init(api);
            PP.UI.updateMenu();
            updateMenuLabel();
            PP.UI.hideBoot();
            PP.UI.showMenu(true);
            PP.UI.setHUDVisible(false);
            spawnCamera();
            applySettings();
            updateSceneMood(0.016);
            bootMark('ui', uiStart);
            requestAnimationFrame(animate);
            PP.UI.setBoot(1, 'Monde prêt');
            bootTimings.total = Math.round(performance.now() - bootStart);
        } catch (error) {
            console.error('Échec du démarrage', error);
            const label = document.getElementById('boot-label');
            if (label) label.textContent = `ERREUR : ${error.message}`;
        }
    }

    window.addEventListener('load', boot);

    return api;
})();
