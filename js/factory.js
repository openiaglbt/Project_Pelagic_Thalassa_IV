/* ============================================================================
 * factory.js — Construction, énergie, production, convoyeurs pneumatiques,
 * drones autonomes et logistique du complexe industriel.
 * ==========================================================================*/
window.PP = window.PP || {};

PP.Factory = (function () {
    'use strict';

    const D = PP.Data;
    const U = D.UTILS;

    function create(scene, world, state, getPlayer) {
        const api = {
            scene, world, state,
            interactables: [],
            pipes: state.pipes,
            drones: state.drones,
            ghost: null,
            ghostMat: new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.32, depthWrite: false }),
            ghostBadMat: new THREE.MeshBasicMaterial({ color: 0xfb7185, transparent: true, opacity: 0.38, depthWrite: false }),
            ghostGrid: null,
            lastPowerCalc: 0
        };

        const notify = (title, text, type) => {
            if (PP.UI && PP.UI.toast) PP.UI.toast(text, type || 'info', title);
        };

        /* ------------------------------------------------------------------ */
        /* MATÉRIAUX & GÉOMÉTRIE                                               */
        /* ------------------------------------------------------------------ */
        const MATS = {
            hull: () => new THREE.MeshStandardMaterial({ color: 0xa9bcc7, metalness: 0.62, roughness: 0.34 }),
            hullDark: () => new THREE.MeshStandardMaterial({ color: 0x1f2a33, metalness: 0.72, roughness: 0.35 }),
            amber: () => new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xb45309, emissiveIntensity: 0.4, metalness: 0.5, roughness: 0.4 }),
            teal: () => new THREE.MeshStandardMaterial({ color: 0x0f766e, metalness: 0.55, roughness: 0.35 }),
            steel: () => new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.85, roughness: 0.25 }),
            glass: () => new THREE.MeshStandardMaterial({
                color: 0x67e8f9, transparent: true, opacity: 0.34, metalness: 0.3, roughness: 0.08,
                side: THREE.DoubleSide, depthWrite: false
            }),
            glowCyan: () => new THREE.MeshBasicMaterial({ color: 0x22d3ee }),
            glowAmber: () => new THREE.MeshBasicMaterial({ color: 0xfbbf24 }),
            glowGreen: () => new THREE.MeshBasicMaterial({ color: 0x34d399 }),
            glowRose: () => new THREE.MeshBasicMaterial({ color: 0xfb7185 }),
            glowViolet: () => new THREE.MeshBasicMaterial({ color: 0xc084fc }),
            darkGlass: () => new THREE.MeshStandardMaterial({ color: 0x0e7490, transparent: true, opacity: 0.45, metalness: 0.4, roughness: 0.15 })
        };

        function add(mesh, parent, cast = true) {
            mesh.castShadow = !!cast && state.settings.quality !== 'low';
            parent.add(mesh);
            return mesh;
        }

        let pointLightBudget = 10;
        function addLamp(parent, color, intensity, distance, y) {
            if (pointLightBudget <= 0) return null;
            pointLightBudget--;
            const light = new THREE.PointLight(color, intensity, distance, 2);
            light.position.y = y;
            parent.add(light);
            return light;
        }

        function halo(parent, color, size, y = 0) {
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: world.glowTex, color, transparent: true, opacity: 0.55,
                blending: THREE.AdditiveBlending, depthWrite: false
            }));
            sprite.scale.set(size, size, 1);
            sprite.position.y = y;
            parent.add(sprite);
            return sprite;
        }

        /* ------------------------------------------------------------------ */
        /* ARCHITECTURE DES MODULES                                            */
        /* ------------------------------------------------------------------ */
        /* Ombre de contact : une tache radiale douce qui ancre le module au
           sol, même hors du champ de la carte d'ombre directionnelle. */
        let contactTex = null;
        function contactShadowTexture() {
            if (contactTex) return contactTex;
            const c = document.createElement('canvas');
            c.width = c.height = 128;
            const ctx = c.getContext('2d');
            const grad = ctx.createRadialGradient(64, 64, 3, 64, 64, 62);
            grad.addColorStop(0, 'rgba(0,0,0,0.88)');
            grad.addColorStop(0.52, 'rgba(0,0,0,0.46)');
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 128, 128);
            contactTex = new THREE.CanvasTexture(c);
            return contactTex;
        }

        function addContactShadow(group, footprint) {
            const shadow = new THREE.Mesh(
                new THREE.PlaneGeometry(1, 1),
                new THREE.MeshBasicMaterial({
                    map: contactShadowTexture(), transparent: true, opacity: 0.66,
                    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2
                })
            );
            shadow.userData.noPick = true;
            shadow.rotation.x = -Math.PI / 2;
            shadow.position.y = 0.08;
            shadow.scale.set(footprint, footprint, 1);
            shadow.renderOrder = 1;
            group.add(shadow);
        }

        function createMesh(type) {
            const g = new THREE.Group();
            const steel = MATS.steel();
            const hull = MATS.hull();
            const dark = MATS.hullDark();

            if (type === 'hub') {
                const base = add(new THREE.Mesh(new THREE.CylinderGeometry(6.4, 7.4, 2.2, 12), MATS.hullDark()), g);
                base.position.y = 0.6;
                const ring = add(new THREE.Mesh(new THREE.TorusGeometry(6.1, 0.34, 8, 28), MATS.amber()), g);
                ring.rotation.x = Math.PI / 2; ring.position.y = 1.7;
                const capsule = add(new THREE.Mesh(new THREE.SphereGeometry(5.4, 20, 14), hull), g);
                capsule.scale.set(1, 0.82, 1); capsule.position.y = 5.3;
                const belt = add(new THREE.Mesh(new THREE.CylinderGeometry(5.45, 5.45, 1.0, 20), MATS.amber()), g);
                belt.position.y = 5.1;
                // Nervures de coque : cassent la lecture « sphère lisse ».
                [-1.9, 1.9].forEach(dy => {
                    const rr = 5.4 * Math.sqrt(Math.max(0.05, 1 - Math.pow(dy / 4.43, 2)));
                    const rib = add(new THREE.Mesh(new THREE.TorusGeometry(rr, 0.075, 6, 30), steel), g);
                    rib.rotation.x = Math.PI / 2;
                    rib.position.y = 5.3 + dy;
                });
                for (let i = 0; i < 4; i++) {
                    const rib = add(new THREE.Mesh(new THREE.TorusGeometry(5.36, 0.055, 5, 30), steel), g);
                    rib.rotation.y = (i / 4) * Math.PI;
                    rib.position.y = 5.3;
                }
                const airlock = add(new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 2.2, 10), steel), g);
                airlock.rotation.z = Math.PI / 2;
                airlock.position.set(-5.4, 4.6, 0);
                const lockRing = add(new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.13, 6, 16), MATS.amber()), g);
                lockRing.rotation.y = Math.PI / 2;
                lockRing.position.set(-6.45, 4.6, 0);
                const vent = add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 3.2), MATS.hullDark()), g);
                vent.position.set(4.9, 7.4, 0);
                const dome = add(new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), MATS.glass()), g);
                dome.position.y = 8.5;
                for (let i = 0; i < 6; i++) {
                    const leg = add(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.36, 4.2, 6), steel), g);
                    const a = (i / 6) * Math.PI * 2;
                    leg.position.set(Math.cos(a) * 5.9, -0.8, Math.sin(a) * 5.9);
                    leg.rotation.z = Math.cos(a) * 0.32;
                    leg.rotation.x = -Math.sin(a) * 0.32;
                }
                for (let i = 0; i < 5; i++) {
                    const win = add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 0.2), MATS.glowCyan()), g);
                    const a = (i / 5) * Math.PI * 2;
                    win.position.set(Math.cos(a) * 5.25, 5.6, Math.sin(a) * 5.25);
                    win.lookAt(0, 5.6, 0);
                }
                const mast = add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 8, 5), steel), g);
                mast.position.y = 12;
                const beacon = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), MATS.glowAmber()), g);
                beacon.position.y = 16.1; beacon.name = 'beacon';
                halo(g, 0xfbbf24, 8, 16.4);
                addLamp(g, 0x22d3ee, 2.2, 46, 6);
            } else if (type === 'habitat') {
                const base = add(new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.8, 1.0, 10), MATS.hullDark()), g);
                base.position.y = 0.5;
                const body = add(new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.7, 4.2, 14), hull), g);
                body.position.y = 3.1;
                const stripe = add(new THREE.Mesh(new THREE.CylinderGeometry(3.74, 3.74, 0.65, 14), MATS.amber()), g);
                stripe.position.y = 3.2;
                const dome = add(new THREE.Mesh(new THREE.SphereGeometry(3.3, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), MATS.glass()), g);
                dome.position.y = 5.2;
                const hatch = add(new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.4, 10), MATS.steel()), g);
                hatch.rotation.z = Math.PI / 2; hatch.position.set(3.8, 2.4, 0);
                for (let i = 0; i < 4; i++) {
                    const win = add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.65, 0.2), MATS.glowCyan()), g);
                    const a = (i / 4) * Math.PI * 2 + 0.6;
                    win.position.set(Math.cos(a) * 3.62, 3.6, Math.sin(a) * 3.62);
                    win.lookAt(0, 3.6, 0);
                }
                const tankGeo = THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.8, 2.4, 4, 8) : new THREE.CylinderGeometry(0.8, 0.8, 3.2, 8);
                const tank = add(new THREE.Mesh(tankGeo, MATS.steel()), g);
                tank.position.set(-3.1, 2.3, -2.4);
                halo(g, 0x22d3ee, 7, 5.6);
            } else if (type === 'drill') {
                const base = add(new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.7, 4.4), MATS.hullDark()), g);
                base.position.y = 0.35;
                for (let i = 0; i < 4; i++) {
                    const leg = add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 2.4, 5), steel), g);
                    const a = (i / 4) * Math.PI * 2 + 0.4;
                    leg.position.set(Math.cos(a) * 2.2, 0.9, Math.sin(a) * 2.2);
                    leg.rotation.z = Math.cos(a) * 0.24;
                }
                const frame = add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.6, 2.6), MATS.amber()), g);
                frame.position.y = 3.2;
                const housing = add(new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.3, 1.5, 8), hull), g);
                housing.position.y = 5.4;
                const rotor = add(new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.6, 8), MATS.steel()), g);
                rotor.rotation.x = Math.PI; rotor.position.y = 1.65; rotor.name = 'rotor';
                const wheel = add(new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.16, 6, 16), MATS.glowAmber()), g);
                wheel.rotation.x = Math.PI / 2; wheel.position.y = 5.1; wheel.name = 'rotor2';
                halo(g, 0xfbbf24, 6, 5.2);
                addLamp(g, 0xfbbf24, 1.4, 20, 4.6);
            } else if (type === 'smelter') {
                const casing = add(new THREE.Mesh(new THREE.BoxGeometry(5.0, 3.4, 4.2), dark), g);
                casing.position.y = 1.7;
                const trim = add(new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.35, 4.4), MATS.amber()), g);
                trim.position.y = 3.2;
                const crucible = add(new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.4, 12), new THREE.MeshStandardMaterial({
                    color: 0xf97316, emissive: 0xea580c, emissiveIntensity: 1.0, metalness: 0.3, roughness: 0.4
                })), g);
                crucible.position.y = 1.9; crucible.name = 'crucible';
                for (let i = 0; i < 2; i++) {
                    const chimney = add(new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.62, 3.4, 8), steel), g);
                    chimney.position.set(-1.5 + i * 3.0, 4.8, -1.2);
                }
                const pipe = add(new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.22, 6, 18, Math.PI), MATS.steel()), g);
                pipe.position.set(0, 2.8, 2.1); pipe.rotation.z = 0;
                halo(g, 0xfb923c, 8, 2.6);
                addLamp(g, 0xff7b32, 2.0, 24, 2.6);
            } else if (type === 'thermal') {
                const base = add(new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.4, 1.2, 10), MATS.hullDark()), g);
                base.position.y = 0.6;
                const tower = add(new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.2, 6.2, 12), MATS.steel()), g);
                tower.position.y = 3.6;
                const ring1 = add(new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.16, 6, 20), MATS.glowGreen()), g);
                ring1.rotation.x = Math.PI / 2; ring1.position.y = 4.2;
                const ring2 = ring1.clone(); ring2.position.y = 5.6; ring2.scale.setScalar(0.78); g.add(ring2);
                const rotor = add(new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.3, 8), MATS.amber()), g);
                rotor.position.y = 6.9; rotor.name = 'rotor';
                for (let i = 0; i < 4; i++) {
                    const blade = add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 0.55), hull), g);
                    blade.position.y = 6.9;
                    blade.rotation.y = (i / 4) * Math.PI;
                    blade.name = 'rotor';
                }
                halo(g, 0x34d399, 9, 7);
                addLamp(g, 0x34d399, 1.6, 26, 5);
            } else if (type === 'scanner') {
                const base = add(new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.8, 1.0, 12), MATS.hullDark()), g);
                base.position.y = 0.5;
                const deck = add(new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.4, 0.5, 12), MATS.steel()), g);
                deck.position.y = 1.2;
                const dome = add(new THREE.Mesh(new THREE.IcosahedronGeometry(4.2, 1), new THREE.MeshStandardMaterial({
                    color: 0x22d3ee, wireframe: true, emissive: 0x06b6d4, emissiveIntensity: 0.8, transparent: true, opacity: 0.9
                })), g);
                dome.position.y = 4.3; dome.name = 'rotor';
                const core = add(new THREE.Mesh(new THREE.OctahedronGeometry(1.3, 0), MATS.glowCyan()), g);
                core.position.y = 3.1; core.name = 'beacon';
                const ring = add(new THREE.Mesh(new THREE.TorusGeometry(3.0, 0.1, 5, 24), MATS.glowCyan()), g);
                ring.rotation.x = Math.PI / 2; ring.position.y = 2.0;
                halo(g, 0x22d3ee, 12, 4.4);
                addLamp(g, 0x22d3ee, 2.4, 32, 4);
                const pulse = new THREE.Mesh(new THREE.CircleGeometry(24, 32), new THREE.MeshBasicMaterial({
                    color: 0x22d3ee, transparent: true, opacity: 0.045, side: THREE.DoubleSide, depthWrite: false
                }));
                pulse.rotation.x = -Math.PI / 2; pulse.position.y = 0.15; pulse.name = 'pulse'; g.add(pulse);
            } else if (type === 'droneBay') {
                const base = add(new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.9, 5.2), MATS.hullDark()), g);
                base.position.y = 0.45;
                const hangar = add(new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.8, 6.0, 12), dark), g);
                hangar.rotation.z = Math.PI / 2; hangar.position.y = 3.2;
                for (let i = 0; i < 3; i++) {
                    const r = add(new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.16, 6, 18), MATS.glowCyan()), g);
                    r.rotation.y = Math.PI / 2; r.position.set(-2.6 + i * 2.6, 3.2, 0);
                }
                const pad = add(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.2, 12), MATS.steel()), g);
                pad.position.set(0, 0.95, 3.4);
                halo(g, 0x38bdf8, 9, 3.4);
                addLamp(g, 0x38bdf8, 1.6, 24, 3.4);
            } else if (type === 'garden') {
                const base = add(new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.6, 0.8, 12), MATS.hullDark()), g);
                base.position.y = 0.4;
                const soil = add(new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.6, 0.6, 12), new THREE.MeshStandardMaterial({ color: 0x1e3a2f, roughness: 0.9 })), g);
                soil.position.y = 1.0;
                const dome = add(new THREE.Mesh(new THREE.SphereGeometry(4.6, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), MATS.glass()), g);
                dome.position.y = 1.3;
                for (let i = 0; i < 9; i++) {
                    const plant = add(new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.2 + Math.random() * 1.8, 5), new THREE.MeshStandardMaterial({
                        color: 0x10b981, emissive: 0x065f46, emissiveIntensity: 0.5
                    })), g);
                    const a = (i / 9) * Math.PI * 2;
                    plant.position.set(Math.cos(a) * (1.5 + (i % 3)), 2.1, Math.sin(a) * (1.5 + (i % 3)));
                }
                addLamp(g, 0x86efac, 1.4, 20, 4.0);
                halo(g, 0x4ade80, 10, 3.2);
            } else if (type === 'storage') {
                const base = add(new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.8, 4.6), MATS.hullDark()), g);
                base.position.y = 0.4;
                for (let i = 0; i < 3; i++) {
                    const box = add(new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.3, 3.6), new THREE.MeshStandardMaterial({
                        color: i % 2 ? 0x334155 : 0x475569, metalness: 0.6, roughness: 0.4
                    })), g);
                    box.position.set(0, 1.5 + i * 1.45, 0);
                }
                const stripe = add(new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.18, 3.7), MATS.amber()), g);
                stripe.position.y = 2.9;
                halo(g, 0xfbbf24, 6, 4.2);
            } else if (type === 'reactor') {
                const base = add(new THREE.Mesh(new THREE.CylinderGeometry(5.4, 6.0, 1.4, 10), MATS.hullDark()), g);
                base.position.y = 0.7;
                for (let i = 0; i < 4; i++) {
                    const strut = add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 7, 6), steel), g);
                    const a = (i / 4) * Math.PI * 2;
                    strut.position.set(Math.cos(a) * 3.8, 4.2, Math.sin(a) * 3.8);
                    strut.rotation.z = Math.cos(a) * 0.16;
                    strut.rotation.x = -Math.sin(a) * 0.16;
                }
                const core = add(new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 12), new THREE.MeshStandardMaterial({
                    color: 0xfacc15, emissive: 0xf59e0b, emissiveIntensity: 1.4, roughness: 0.15, metalness: 0.3,
                    transparent: true, opacity: 0.92
                })), g);
                core.position.y = 5.4; core.name = 'crucible';
                for (let i = 0; i < 2; i++) {
                    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(3.7, 0.18, 8, 28), MATS.glowViolet()), g);
                    ring.position.y = 5.4; ring.rotation.x = Math.PI / 2 + i * 0.7; ring.name = 'rotor';
                }
                halo(g, 0xc084fc, 16, 5.4);
                addLamp(g, 0xc084fc, 3.0, 42, 5.4);
            }

            g.traverse(c => { if (c.isMesh && !c.userData.noPick) c.userData.buildingType = type; });
            // Empreinte au sol proportionnée au module.
            const footprints = { hub: 30, habitat: 16, drill: 17, smelter: 17, geothermal: 21, conveyor: 8, scanner: 15, drone: 12, defense: 16 };
            addContactShadow(g, footprints[type] || 16);
            return g;
        }

        /* ------------------------------------------------------------------ */
        /* HUB INITIAL                                                         */
        /* ------------------------------------------------------------------ */
        function spawnHub() {
            const y = world.height(0, 0);
            const mesh = createMesh('hub');
            mesh.position.set(0, y, 0);
            scene.add(mesh);
            const hub = {
                id: 1, kind: 'building', type: 'hub', name: 'Capsule de survie',
                position: new THREE.Vector3(0, y, 0), mesh, power: 25,
                inputBuffer: {}, outputBuffer: {}, recipe: null, progress: 0,
                linkedNodeId: null, linkedVentId: null, depleted: false
            };
            mesh.traverse(c => { if (c.isMesh) c.userData.entity = hub; });
            state.buildings.push(hub);
            api.interactables.push(mesh);
            state.nextBuildingId = Math.max(2, state.nextBuildingId || 2);
            recalcPower();
            return hub;
        }

        /* ------------------------------------------------------------------ */
        /* VALIDATION DU PLACEMENT                                             */
        /* ------------------------------------------------------------------ */
        api.validate = function (def, x, z) {
            const result = { ok: true, x, z, y: 0, reason: '', node: null, vent: null, slope: 0 };
            if (!def) { result.ok = false; result.reason = 'Module inconnu'; return result; }
            if (Math.abs(x) > D.WORLD.HALF - 45 || Math.abs(z) > D.WORLD.HALF - 45) {
                result.ok = false; result.reason = 'Hors des limites du bassin';
                return result;
            }

            // Ancrer d'abord le module sur son support (filon / évent), puis
            // évaluer le relief et l'encombrement à l'emplacement réel.
            if (def.requiresNode) {
                let best = null, bestD = Number.isFinite(def.snapRange) ? def.snapRange : 11;
                world.nodes.forEach(n => {
                    if (n.stock <= 0 || n.occupied) return;
                    const d = Math.hypot(n.position.x - x, n.position.z - z);
                    if (d < bestD) { bestD = d; best = n; }
                });
                if (!best) { result.ok = false; result.reason = 'Aucun filon libre à portée'; return result; }
                result.node = best;
                result.x = best.position.x; result.z = best.position.z; result.y = best.position.y;
            }
            if (def.type === 'thermal') {
                let best = null, bestD = 12;
                world.vents.forEach(v => {
                    if (v.occupied) return;
                    const d = Math.hypot(v.position.x - x, v.position.z - z);
                    if (d < bestD) { bestD = d; best = v; }
                });
                result.vent = best;
                if (best) { result.x = best.position.x; result.z = best.position.z; result.y = best.position.y; }
            }

            result.slope = world.slopeAt(result.x, result.z);
            result.y = result.node ? result.node.position.y : world.height(result.x, result.z);
            const slopeLimit = result.node ? 1.1 : def.type === 'scanner' ? 0.38 : 0.6;
            if (result.slope > slopeLimit) {
                result.ok = false; result.reason = 'Relief trop accidenté';
            }
            if (def.tech && !state.unlockedTechs[def.tech]) {
                result.ok = false; result.reason = 'Technologie non débloquée';
            }
            const distHub = Math.hypot(result.x, result.z);
            if (distHub < 14 && def.type !== 'thermal') { result.ok = false; result.reason = 'Trop près de la capsule'; }
            for (const b of state.buildings) {
                const other = D.BUILDINGS[b.type];
                const minDist = ((def.footprint || 4) + ((other && other.footprint) || 4)) * 0.38;
                if (b.position.distanceTo(new THREE.Vector3(result.x, b.position.y, result.z)) < minDist) {
                    result.ok = false; result.reason = 'Encombrement du site';
                    break;
                }
            }
            return result;
        };

        /* ------------------------------------------------------------------ */
        /* GHOST DE CONSTRUCTION                                               */
        /* ------------------------------------------------------------------ */
        api.beginGhost = function (type) {
            api.endGhost();
            const def = D.BUILD_LIST.find(b => b.type === type);
            if (!def) return;
            const ghost = createMesh(type);
            ghost.traverse(c => {
                if (!c.isMesh) return;
                if (Array.isArray(c.material)) c.material.forEach(m => { if (m && m.dispose) m.dispose(); });
                else if (c.material && c.material.dispose) c.material.dispose();
                c.material = api.ghostMat;
                c.castShadow = false;
            });
            const ringGeo = new THREE.RingGeometry(def.footprint * 0.5, def.footprint * 0.5 + 0.25, 40);
            ringGeo.rotateX(-Math.PI / 2);
            const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
                color: 0x22d3ee, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false
            }));
            ring.name = 'footprint';
            ghost.add(ring);
            ghost.userData.def = def;
            scene.add(ghost);
            api.ghost = ghost;
        };

        api.endGhost = function () {
            if (!api.ghost) return;
            scene.remove(api.ghost);
            api.ghost.traverse(c => {
                if (c.isMesh && c.material !== api.ghostMat && c.material !== api.ghostBadMat) {
                    c.geometry.dispose();
                    c.material.dispose && c.material.dispose();
                } else if (c.geometry) {
                    c.geometry.dispose();
                }
            });
            api.ghost = null;
        };

        api.updateGhost = function (def, placement, rotation) {
            if (!api.ghost) return;
            api.ghost.position.set(placement.x, placement.y, placement.z);
            api.ghost.rotation.y = rotation || 0;
            const ok = !!placement.ok;
            const mat = ok ? api.ghostMat : api.ghostBadMat;
            api.ghost.traverse(c => {
                if (c.isMesh && c.name !== 'footprint') c.material = mat;
            });
            const ring = api.ghost.getObjectByName('footprint');
            if (ring) ring.material.color.set(ok ? 0x22d3ee : 0xfb7185);
            api.ghost.visible = true;
        };

        /* ------------------------------------------------------------------ */
        /* CONSTRUCTION                                                        */
        /* ------------------------------------------------------------------ */
        api.pay = function (cost) {
            for (const [key, value] of Object.entries(cost || {})) {
                if ((state.inventory[key] || 0) < value) return false;
            }
            Object.entries(cost || {}).forEach(([key, value]) => {
                state.inventory[key] = (state.inventory[key] || 0) - value;
            });
            return true;
        };

        api.place = function (def, placement, rotation) {
            if (!def) return { ok: false, reason: 'Module inconnu' };
            if (!placement.ok) return { ok: false, reason: placement.reason || 'Emplacement invalide' };
            if (!api.pay(def.cost)) return { ok: false, reason: 'Ressources insuffisantes' };

            const mesh = createMesh(def.type);
            mesh.position.set(placement.x, placement.y, placement.z);
            mesh.rotation.y = rotation || 0;
            scene.add(mesh);

            let power = def.power;
            if (def.type === 'thermal' && placement.vent) power = 70;
            const building = {
                id: state.nextBuildingId++,
                kind: 'building', type: def.type, name: def.name,
                position: new THREE.Vector3(placement.x, placement.y, placement.z),
                mesh, power,
                inputBuffer: {}, outputBuffer: {},
                recipe: def.type === 'smelter' ? 'titaniumIngot' : null,
                progress: 0,
                linkedNodeId: placement.node ? world.nodes.indexOf(placement.node) : null,
                linkedVentId: placement.vent ? world.vents.indexOf(placement.vent) : null,
                level: 1,
                depleted: false,
                scanTimer: 0
            };
            applyLevelVisual(building);
            if (placement.node) placement.node.occupied = true;
            if (placement.vent) placement.vent.occupied = true;

            mesh.traverse(c => { if (c.isMesh && !c.userData.noPick) c.userData.entity = building; });
            state.buildings.push(building);
            api.interactables.push(mesh);
            state.stats.buildCount = (state.stats.buildCount || 0) + 1;

            if (def.type === 'droneBay') spawnDrone(building);
            if (def.type === 'habitat') state.stats.habitats = (state.stats.habitats || 0) + 1;
            if (def.type === 'thermal' && placement.vent) state.stats.ventThermals = (state.stats.ventThermals || 0) + 1;

            recalcPower();
            if (PP.Audio) PP.Audio.build();
            notify('MODULE DÉPLOYÉ', `${def.name} opérationnel${def.type === 'thermal' && placement.vent ? ' · bonus hydrothermal +70 MW' : ''}`, 'success');
            if (state.stats.buildCount === 1 && PP.Game && PP.Game.hint) PP.Game.hint('Configurez le module avec [E] pour choisir sa recette.');
            return { ok: true, building };
        };

        /* ------------------------------------------------------------------ */
        /* CONVOYEURS                                                          */
        /* ------------------------------------------------------------------ */
        api.connect = function (from, to) {
            if (!from || !to || from.id === to.id) return { ok: false, reason: 'Liaison invalide' };
            if (state.pipes.some(p => p.fromId === from.id && p.toId === to.id)) {
                return { ok: false, reason: 'Ce convoyeur existe déjà' };
            }
            if (!api.pay({ titaniumIngot: 1, magnetCoil: 1 })) {
                return { ok: false, reason: '1 Lingot de titane + 1 bobine requis' };
            }
            const pipe = createPipe(from, to);
            if (PP.Audio) PP.Audio.build();
            notify('CONVOYEUR CONNECTÉ', `${from.name} → ${to.name}`, 'success');
            return { ok: true, pipe };
        };

        function createPipe(from, to) {
            const start = from.position.clone().add(new THREE.Vector3(0, 2.4, 0));
            const end = to.position.clone().add(new THREE.Vector3(0, 2.4, 0));
            const mid = start.clone().lerp(end, 0.5);
            mid.y += Math.min(10, 2 + start.distanceTo(end) * 0.08);
            const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
            const tube = new THREE.Mesh(
                new THREE.TubeGeometry(curve, Math.max(16, Math.floor(start.distanceTo(end) / 3)), 0.26, 7, false),
                new THREE.MeshStandardMaterial({
                    color: 0xfacc15, emissive: 0x0891b2, emissiveIntensity: 0.35,
                    transparent: true, opacity: 0.72, roughness: 0.35, metalness: 0.4
                })
            );
            tube.castShadow = state.settings.quality === 'high' || state.settings.quality === 'ultra';
            scene.add(tube);
            const packet = new THREE.Mesh(
                new THREE.SphereGeometry(0.34, 8, 8),
                new THREE.MeshBasicMaterial({ color: 0x22d3ee })
            );
            packet.visible = false;
            scene.add(packet);
            const pipe = {
                fromId: from.id, toId: to.id, curve, tubeMesh: tube, packetMesh: packet,
                carrying: null, transit: 0, speed: 0.9, cooldown: 0
            };
            state.pipes.push(pipe);
            return pipe;
        }

        api.createPipeBetween = createPipe;

        /* ------------------------------------------------------------------ */
        /* DRONES                                                              */
        /* ------------------------------------------------------------------ */
        function spawnDrone(bay) {
            const group = new THREE.Group();
            const body = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), new THREE.MeshStandardMaterial({
                color: 0xf59e0b, metalness: 0.7, roughness: 0.25
            }));
            body.scale.set(1.5, 0.55, 1.1);
            group.add(body);
            const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), new THREE.MeshStandardMaterial({
                color: 0x22d3ee, emissive: 0x0891b2, emissiveIntensity: 0.8, roughness: 0.2
            }));
            cockpit.position.set(0.3, 0.4, 0.45); group.add(cockpit);
            for (let i = 0; i < 4; i++) {
                const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 4), MATS.steel());
                const a = (i / 4) * Math.PI * 2 + 0.4;
                arm.position.set(Math.cos(a) * 1.1, 0.05, Math.sin(a) * 1.1);
                arm.rotation.z = Math.PI / 2; arm.rotation.y = -a; group.add(arm);
                const rotor = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.05, 4, 12), MATS.glowCyan());
                rotor.rotation.x = Math.PI / 2;
                rotor.position.set(Math.cos(a) * 1.7, 0.22, Math.sin(a) * 1.7);
                rotor.name = 'rotor'; group.add(rotor);
            }
            const halo = new THREE.Sprite(new THREE.SpriteMaterial({
                map: world.glowTex, color: 0x22d3ee, transparent: true, opacity: 0.45,
                blending: THREE.AdditiveBlending, depthWrite: false
            }));
            halo.scale.set(4, 4, 1); halo.position.y = 0.3; group.add(halo);
            group.position.copy(bay.position).add(new THREE.Vector3(2.5, 3.2, 2.5));
            scene.add(group);
            const drone = {
                bayId: bay.id, mesh: group, state: 'idle', target: null,
                cargo: null, cargoQty: 0, timer: 0, bob: Math.random() * 6
            };
            state.drones.push(drone);
            if (PP.Audio) PP.Audio.drone();
            return drone;
        }

        /* ------------------------------------------------------------------ */
        /* ÉNERGIE                                                             */
        /* ------------------------------------------------------------------ */
        // Le niveau d'un module est une vraie décision industrielle : il
        // augmente le débit, la portée ou le stockage, mais aussi la charge.
        function powerFor(b) {
            const def = D.BUILDINGS[b.type];
            if (!def) return b.power || 0;
            const level = Math.max(1, Math.min(3, b.level || 1));
            if (b.type === 'hub') return 25;
            if (b.type === 'thermal') {
                const base = Number.isInteger(b.linkedVentId) && b.linkedVentId >= 0 ? 70 : 30;
                return Math.round(base * Math.pow(1.25, level - 1));
            }
            if (b.type === 'reactor') {
                const base = 140 + (state.unlockedTechs.xenoPower ? 20 : 0);
                return Math.round(base * Math.pow(1.2, level - 1));
            }
            const base = def.power;
            return base < 0
                ? -Math.round(Math.abs(base) * Math.pow(1.16, level - 1))
                : Math.round(base * Math.pow(1.2, level - 1));
        }

        function applyLevelVisual(b) {
            if (!b.mesh) return;
            const old = b.mesh.getObjectByName('level-rings');
            if (old) { b.mesh.remove(old); disposeGroup(old); }
            if ((b.level || 1) <= 1) return;
            const group = new THREE.Group();
            group.name = 'level-rings';
            const def = D.BUILDINGS[b.type];
            const radius = Math.max(2.2, (def.footprint || 4) * 0.34);
            for (let i = 0; i < b.level - 1; i++) {
                const ring = new THREE.Mesh(
                    new THREE.TorusGeometry(radius + i * 0.28, 0.075, 5, 30),
                    new THREE.MeshBasicMaterial({
                        color: b.level >= 3 ? 0xfbbf24 : 0x22d3ee,
                        transparent: true, opacity: 0.65,
                        blending: THREE.AdditiveBlending, depthWrite: false
                    })
                );
                ring.rotation.x = Math.PI / 2;
                ring.position.y = 0.30 + i * 0.24;
                group.add(ring);
            }
            b.mesh.add(group);
        }

        function recalcPower() {
            let produced = 0, consumed = 0;
            for (const b of state.buildings) {
                b.power = powerFor(b);
                if (b.power > 0) produced += b.power;
                else consumed += Math.abs(b.power);
            }
            // Protocole SURCHARGE : les générateurs sont poussés au-delà du
            // nominal, au prix d'une usure visuelle et d'un pic de bruit.
            if ((state.surgeTimer || 0) > 0) produced = Math.round(produced * 1.5);
            state.powerProduced = produced;
            state.powerConsumed = consumed;
            state.powerEfficiency = consumed <= 0 ? 1 : Math.min(1, produced / consumed);
            state.powerReserve = produced - consumed;
            const deficit = consumed > produced;
            if (deficit !== !!state.powerWarning) {
                state.powerWarning = deficit;
                if (state.isPlaying) {
                    if (deficit) notify('RÉSEAU SOUS-ALIMENTÉ', `Demande ${consumed} MW pour ${produced} MW produits. Réduisez la charge ou ajoutez une prise géothermique.`, 'warn');
                    else notify('RÉSEAU STABLE', `Production ${produced} MW pour ${consumed} MW consommés.`, 'success');
                }
            }
        }

        api.recalcPower = recalcPower;
        api.powerFor = powerFor;
        api.applyLevelVisual = applyLevelVisual;

        api.upgradeCost = function (b) {
            const def = b && D.BUILDINGS[b.type];
            if (!def || b.type === 'hub') return null;
            const level = b.level || 1;
            if (level >= 3) return null;
            const cost = {};
            Object.entries(def.cost).forEach(([key, value]) => {
                cost[key] = Math.max(1, Math.round(value * (0.9 * level)));
            });
            if (level >= 2) cost.thermicAlloy = (cost.thermicAlloy || 0) + 2;
            return cost;
        };

        api.upgrade = function (b) {
            if (!b || b.type === 'hub') return { ok: false, reason: 'La capsule ne peut pas être améliorée' };
            const level = b.level || 1;
            if (level >= 3) return { ok: false, reason: 'Niveau maximal atteint' };
            if (level >= 2 && !state.unlockedTechs.xenoPower) {
                return { ok: false, reason: 'Confinement xéno requis pour le niveau III' };
            }
            if (level >= 1 && !state.unlockedTechs.metallurgy) {
                return { ok: false, reason: 'Métallurgie extrême requise pour améliorer un module' };
            }
            const cost = api.upgradeCost(b);
            if (!cost || !api.pay(cost)) return { ok: false, reason: 'Ressources insuffisantes pour l\'amélioration' };
            b.level = level + 1;
            b.power = powerFor(b);
            applyLevelVisual(b);
            recalcPower();
            notify('MODULE AMÉLIORÉ', `${b.name} · Mk.${b.level} opérationnel. Débit et charge augmentés.`, 'success');
            if (PP.Audio) PP.Audio.build();
            return { ok: true, level: b.level };
        };

        api.setRecipe = function (b, recipeId) {
            const recipe = D.SMELTER_RECIPES[recipeId];
            if (!b || !recipe) return false;
            if (recipe.tech && !state.unlockedTechs[recipe.tech]) {
                notify('RECHERCHE REQUISE', 'Débloquez la technologie de raffinage correspondante.', 'warn');
                return false;
            }
            b.recipe = recipeId;
            b.progress = 0;
            if (PP.Audio) PP.Audio.click();
            return true;
        };

        /* ------------------------------------------------------------------ */
        /* DÉMANTÈLEMENT                                                       */
        /* ------------------------------------------------------------------ */
        api.dismantle = function (b) {
            if (!b || b.type === 'hub') return false;
            // Récupération des buffers
            for (const buffer of [b.inputBuffer, b.outputBuffer]) {
                Object.entries(buffer || {}).forEach(([key, amount]) => {
                    if (D.RESOURCES[key] && Number.isFinite(amount) && amount > 0) {
                        state.inventory[key] = (state.inventory[key] || 0) + Math.floor(amount);
                    }
                });
            }
            // Récupération des matériaux (80 %), améliorations comprises :
            // démonter un module Mk.II ne doit pas faire disparaître le surcoût
            // de recherche et de construction déjà payé par le joueur.
            const def = D.BUILDINGS[b.type];
            const refund = {};
            const addRefund = (key, value) => {
                if (!D.RESOURCES[key] || !Number.isFinite(value) || value <= 0) return;
                refund[key] = (refund[key] || 0) + Math.ceil(value * 0.8);
            };
            Object.entries(b.mesh.userData.cost || (def && def.cost) || {}).forEach(([key, value]) => addRefund(key, value));
            const level = Math.max(1, Math.min(3, b.level || 1));
            for (let l = 1; l < level; l++) {
                Object.entries((def && def.cost) || {}).forEach(([key, value]) => {
                    addRefund(key, Math.max(1, Math.round(value * 0.9 * l)));
                });
                if (l >= 2) addRefund('thermicAlloy', 2);
            }
            Object.entries(refund).forEach(([key, value]) => {
                state.inventory[key] = (state.inventory[key] || 0) + value;
            });
            // Libère les nœuds et évents
            if (Number.isInteger(b.linkedNodeId) && world.nodes[b.linkedNodeId]) world.nodes[b.linkedNodeId].occupied = false;
            if (Number.isInteger(b.linkedVentId) && world.vents[b.linkedVentId]) world.vents[b.linkedVentId].occupied = false;
            // Drones associés
            state.drones = state.drones.filter(d => {
                if (d.bayId !== b.id) return d ? true : false;
                if (d.cargo && d.cargoQty > 0) state.inventory[d.cargo] = (state.inventory[d.cargo] || 0) + d.cargoQty;
                scene.remove(d.mesh);
                disposeGroup(d.mesh);
                return false;
            });
            api.drones = state.drones;
            // Convoyeurs associés
            state.pipes = state.pipes.filter(p => {
                if (p.fromId !== b.id && p.toId !== b.id) return true;
                if (p.carrying) state.inventory[p.carrying] = (state.inventory[p.carrying] || 0) + 1;
                scene.remove(p.tubeMesh); scene.remove(p.packetMesh);
                disposeMesh(p.tubeMesh); disposeMesh(p.packetMesh);
                return false;
            });
            api.pipes = state.pipes;
            const idx = api.interactables.indexOf(b.mesh);
            if (idx !== -1) api.interactables.splice(idx, 1);
            scene.remove(b.mesh);
            disposeGroup(b.mesh);
            state.buildings = state.buildings.filter(x => x.id !== b.id);
            if (b.type === 'habitat') state.stats.habitats = Math.max(0, (state.stats.habitats || 1) - 1);
            recalcPower();
            if (PP.Audio) PP.Audio.cut();
            notify('MODULE DÉMANTELÉ', `${b.name} · 80 % des matériaux récupérés.`, 'warn');
            return true;
        };

        function disposeMesh(mesh) {
            if (!mesh) return;
            if (mesh.geometry) mesh.geometry.dispose();
            if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose && m.dispose());
            else if (mesh.material && mesh.material.dispose) mesh.material.dispose();
        }
        function disposeGroup(group) {
            group.traverse(c => {
                if (c.isMesh || c.isLine || c.isSprite) {
                    if (c.geometry) c.geometry.dispose();
                    if (c.material) {
                        if (Array.isArray(c.material)) c.material.forEach(m => m.dispose && m.dispose());
                        else c.material.dispose && c.material.dispose();
                    }
                }
            });
        }

        /* ------------------------------------------------------------------ */
        /* SIMULATION                                                          */
        /* ------------------------------------------------------------------ */
        const CAP = 30;

        function addBuffer(buffer, key, amount, cap = CAP) {
            const current = buffer[key] || 0;
            const space = Math.max(0, cap - current);
            const added = Math.min(space, amount);
            if (added > 0) buffer[key] = current + added;
            return added;
        }

        api.update = function (dt) {
            const eff = state.powerEfficiency;
            const player = getPlayer ? getPlayer() : null;

            // Modules
            for (const b of state.buildings) {
                // Animations génériques
                const rotors = b.mesh.userData.rotors || null;
                if (!rotors) {
                    const list = [];
                    b.mesh.traverse(c => { if (c.name === 'rotor' || c.name === 'rotor2') list.push(c); });
                    b.mesh.userData.rotors = list;
                }
                if (b.type !== 'hub' && b.type !== 'storage') {
                    b.mesh.userData.rotors.forEach(r => { r.rotation.z += dt * (0.6 + eff * 2.4); });
                }
                const beacon = b.mesh.getObjectByName('beacon');
                if (beacon) {
                    const s = 0.6 + Math.abs(Math.sin(performance.now() * 0.002)) * 0.7;
                    beacon.scale.setScalar(s);
                }
                const crucible = b.mesh.getObjectByName('crucible');
                if (crucible && b.type === 'smelter') {
                    crucible.material.emissiveIntensity = 0.6 + Math.abs(Math.sin(performance.now() * 0.003)) * (b.recipe ? 1.1 : 0.3);
                }

                if (b.type === 'drill') {
                    const node = Number.isInteger(b.linkedNodeId) ? world.nodes[b.linkedNodeId] : null;
                    const res = node ? node.resourceType : null;
                    const interval = (state.unlockedTechs.drillMk2 ? 1.8 : 3.0)
                        * Math.pow(0.82, (b.level || 1) - 1)
                        / (1 + (state.relicBuffs && state.relicBuffs.drill || 0));
                    if (node && res && node.stock > 0 && eff > 0.05) {
                        const cap = (state.unlockedTechs.drillMk2 ? 60 : CAP) + ((b.level || 1) - 1) * 20;
                        const out = b.outputBuffer[res] || 0;
                        if (out < cap) {
                            b.progress += dt * eff;
                            if (b.progress >= interval) {
                                b.progress -= interval;
                                let mined = world.consumeNode(node, 1);
                                if (mined > 0) {
                                    if (res === 'xenoMatter') mined += Math.floor(state.relicBuffs && state.relicBuffs.xeno || 0);
                                    b.outputBuffer[res] = (b.outputBuffer[res] || 0) + mined;
                                    state.stats.mined = (state.stats.mined || 0) + mined;
                                    if (res === 'xenoMatter') state.stats.xenoMined = (state.stats.xenoMined || 0) + mined;
                                }
                            }
                        }
                    } else if (node && node.stock <= 0 && !b.depleted) {
                        b.depleted = true;
                        notify('FILON ÉPUISÉ', `La foreuse n°${b.id} doit être déplacée vers un autre gisement.`, 'warn');
                    }
                } else if (b.type === 'smelter') {
                    const recipe = b.recipe ? D.SMELTER_RECIPES[b.recipe] : null;
                    if (recipe && eff > 0.05) {
                        const outCap = CAP + (state.unlockedTechs.metallurgy ? 15 : 0) + ((b.level || 1) - 1) * 20;
                        if ((b.outputBuffer[recipe.out] || 0) < outCap) {
                            const canFeed = Object.entries(recipe.in).every(([res, qty]) => (b.inputBuffer[res] || 0) >= qty);
                            if (canFeed) {
                                const cycle = recipe.time
                                    * Math.pow(0.87, (b.level || 1) - 1)
                                    / (1 + (state.relicBuffs && state.relicBuffs.craft || 0));
                                b.progress += dt * eff;
                                if (b.progress >= cycle) {
                                    b.progress -= cycle;
                                    Object.entries(recipe.in).forEach(([res, qty]) => { b.inputBuffer[res] -= qty; });
                                    b.outputBuffer[recipe.out] = (b.outputBuffer[recipe.out] || 0) + 1;
                                    state.stats.crafted = (state.stats.crafted || 0) + 1;
                                    if (recipe.out === 'xenoCore' || recipe.out === 'quantumCore') {
                                        state.stats.xenoCoreMade = (state.stats.xenoCoreMade || 0) + (recipe.out === 'xenoCore' ? 1 : 0);
                                    }
                                    if (PP.Audio && Math.random() < 0.4) PP.Audio.craft();
                                }
                            }
                        }
                    }
                } else if (b.type === 'garden') {
                    if (eff > 0.05) {
                        const cycle = 9 * Math.pow(0.85, (b.level || 1) - 1);
                        b.progress += dt * eff;
                        if (b.progress >= cycle) {
                            b.progress -= cycle;
                            addBuffer(b.outputBuffer, 'biofiber', 2 + ((b.level || 1) >= 3 ? 1 : 0), CAP);
                            state.stats.crafted = (state.stats.crafted || 0) + 1;
                        }
                    }
                } else if (b.type === 'scanner') {
                    if (eff > 0.3) {
                        b.scanTimer = (b.scanTimer || 0) + dt;
                        if (b.scanTimer >= 6) {
                            b.scanTimer = 0;
                            let revealed = 0;
                            const range = 620 * Math.pow(1.18, (b.level || 1) - 1) * (1 + (state.relicBuffs && state.relicBuffs.scan || 0));
                            world.nodes.forEach((n, idx) => {
                                if (n.stock > 0 && n.position.distanceTo(b.position) < range) {
                                    if (!state.discoveredNodes.includes(idx)) { state.discoveredNodes.push(idx); revealed++; }
                                }
                            });
                            state.lastScan = performance.now();
                            state.scanOrigin = b.position;
                            if (revealed > 0) {
                                notify('SCAN 360°', `${revealed} nouveau(x) gisement(s) révélé(s) sur la carte.`, 'success');
                                if (PP.Audio) PP.Audio.scan();
                            }
                            const pulse = b.mesh.getObjectByName('pulse');
                            if (pulse) {
                                pulse.material.opacity = 0.4;
                                setTimeout(() => { if (pulse.material) pulse.material.opacity = 0.045; }, 800);
                            }
                        }
                    }
                } else if (b.type === 'storage') {
                    // Transfert lent vers la capsule si proche
                    if (b.position.distanceTo(state.buildings[0].position) < 80) {
                        b.progress += dt;
                        const cycle = 3 / Math.max(1, b.level || 1);
                        if (b.progress >= cycle) {
                            b.progress -= cycle;
                            const keys = Object.keys(b.outputBuffer);
                            if (keys.length) {
                                const key = keys[0];
                                state.inventory[key] = (state.inventory[key] || 0) + 1;
                                b.outputBuffer[key]--;
                                if (b.outputBuffer[key] <= 0) delete b.outputBuffer[key];
                            }
                        }
                    }
                }
            }

            // Convoyeurs
            for (const p of state.pipes) {
                const from = state.buildings.find(b => b.id === p.fromId);
                const to = state.buildings.find(b => b.id === p.toId);
                if (!from || !to) continue;
                if (!p.carrying) {
                    p.cooldown -= dt;
                    if (p.cooldown > 0) continue;
                    const entries = Object.entries(from.outputBuffer).filter(([, qty]) => qty > 0);
                    if (entries.length) {
                        const [res] = entries[0];
                        from.outputBuffer[res] -= 1;
                        if (from.outputBuffer[res] <= 0) delete from.outputBuffer[res];
                        p.carrying = res;
                        p.transit = 0;
                        p.packetMesh.visible = true;
                        p.packetMesh.material.color.set(D.RESOURCES[res] ? D.RESOURCES[res].color : '#22d3ee');
                    }
                } else {
                    p.transit = Math.min(1, p.transit + dt * p.speed * Math.max(0.3, eff));
                    p.packetMesh.position.copy(p.curve.getPoint(p.transit));
                    if (p.transit >= 1) {
                        let delivered = false;
                        if (to.type === 'hub' || to.type === 'habitat') {
                            state.inventory[p.carrying] = (state.inventory[p.carrying] || 0) + 1;
                            delivered = true;
                        } else if (to.type === 'storage') {
                            if (addBuffer(to.outputBuffer, p.carrying, 1, 60 * Math.max(1, to.level || 1)) > 0) delivered = true;
                        } else {
                            if (addBuffer(to.inputBuffer, p.carrying, 1, CAP) > 0) delivered = true;
                        }
                        if (delivered) {
                            p.carrying = null;
                            p.transit = 0;
                            p.packetMesh.visible = false;
                            p.cooldown = 0.25;
                        }
                    }
                }
            }

            // Drones
            for (const d of state.drones) {
                const bay = state.buildings.find(b => b.id === d.bayId);
                if (!bay) continue;
                d.bob += dt;
                d.mesh.position.y += Math.sin(d.bob * 2.2) * dt * 0.5;
                d.mesh.traverse(c => { if (c.name === 'rotor') c.rotation.z += dt * 14; });
                const bayPos = bay.position.clone().add(new THREE.Vector3(2.5, 4.2, 2.5));

                if (d.state === 'idle') {
                    d.mesh.position.lerp(bayPos, Math.min(1, dt * 1.6));
                    if (!d.target) {
                        let best = null, bestD = Infinity;
                        world.nodes.forEach((n, idx) => {
                            if (n.stock <= 0) return;
                            const dist = n.position.distanceToSquared(bay.position);
                            if (dist < bestD && dist < 900 * 900) { bestD = dist; best = n; }
                        });
                        if (best) {
                            d.target = best;
                            d.state = 'outbound';
                        }
                    }
                } else if (d.state === 'outbound' && d.target) {
                    const dest = d.target.position.clone().add(new THREE.Vector3(0, 3.0, 0));
                    const dir = dest.clone().sub(d.mesh.position);
                    if (dir.length() < 2.2) {
                        d.state = 'harvesting';
                        d.timer = 1.6;
                    } else {
                        d.mesh.position.addScaledVector(dir.normalize(), dt * (26 + ((bay.level || 1) - 1) * 5));
                        d.mesh.lookAt(dest);
                    }
                } else if (d.state === 'harvesting') {
                    d.timer -= dt;
                    if (d.timer <= 0) {
                        const qty = world.consumeNode(d.target, 4 + ((bay.level || 1) - 1) * 2);
                        d.cargo = qty > 0 ? d.target.resourceType : null;
                        d.cargoQty = qty;
                        state.stats.mined = (state.stats.mined || 0) + qty;
                        if (d.target.resourceType === 'xenoMatter') state.stats.xenoMined = (state.stats.xenoMined || 0) + qty;
                        d.state = 'returning';
                    }
                } else if (d.state === 'returning') {
                    const dir = bayPos.clone().sub(d.mesh.position);
                    if (dir.length() < 2.0) {
                        if (d.cargo && d.cargoQty > 0) state.inventory[d.cargo] = (state.inventory[d.cargo] || 0) + d.cargoQty;
                        d.cargo = null; d.cargoQty = 0; d.target = null; d.state = 'idle';
                        if (PP.Audio) PP.Audio.pickup();
                    } else {
                        d.mesh.position.addScaledVector(dir.normalize(), dt * 26);
                        d.mesh.lookAt(bayPos);
                    }
                }
                if (d.target && d.target.stock <= 0 && d.state === 'outbound') {
                    d.target = null; d.state = 'idle';
                }
            }
        };

        /* ------------------------------------------------------------------ */
        /* UTILITAIRES                                                         */
        /* ------------------------------------------------------------------ */
        api.getById = function (id) { return state.buildings.find(b => b.id === id); };

        api.nearestBuilding = function (pos, maxDist = 12) {
            let best = null, bestD = maxDist;
            state.buildings.forEach(b => {
                const d = b.position.distanceTo(pos);
                if (d < bestD) { bestD = d; best = b; }
            });
            return best;
        };

        api.serialize = function () {
            return state.buildings.filter(b => b.type !== 'hub').map(b => ({
                id: b.id, type: b.type, name: b.name,
                pos: [b.position.x, b.position.y, b.position.z],
                rot: b.mesh.rotation.y,
                power: b.power,
                level: b.level || 1,
                inputBuffer: { ...b.inputBuffer },
                outputBuffer: { ...b.outputBuffer },
                recipe: b.recipe,
                progress: b.progress,
                linkedNodeId: b.linkedNodeId,
                linkedVentId: b.linkedVentId
            }));
        };

        api.restore = function (records) {
            if (!Array.isArray(records)) return;
            const cleanBuffer = raw => {
                const out = {};
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
                Object.entries(raw).slice(0, 12).forEach(([key, value]) => {
                    if (D.RESOURCES[key] && Number.isFinite(value) && value > 0) out[key] = Math.min(9999, Math.floor(value));
                });
                return out;
            };
            const usedIds = new Set(state.buildings.map(b => b.id));
            records.slice(0, 160).forEach(rec => {
                if (!rec || typeof rec !== 'object') return;
                const def = D.BUILDINGS[rec.type];
                if (!def || !Array.isArray(rec.pos) || rec.pos.length !== 3 || !rec.pos.every(Number.isFinite)) return;
                const pos = new THREE.Vector3(
                    U.clamp(rec.pos[0], -D.WORLD.HALF + 12, D.WORLD.HALF - 12),
                    U.clamp(rec.pos[1], -D.WORLD.MAX_DEPTH / D.WORLD.DEPTH_SCALE - 20, D.WORLD.WATER_Y + 30),
                    U.clamp(rec.pos[2], -D.WORLD.HALF + 12, D.WORLD.HALF - 12)
                );
                const mesh = createMesh(rec.type);
                mesh.position.copy(pos);
                mesh.rotation.y = Number.isFinite(rec.rot) ? rec.rot : 0;
                scene.add(mesh);
                let id;
                if (Number.isInteger(rec.id) && rec.id > 0 && !usedIds.has(rec.id)) id = rec.id;
                else {
                    while (usedIds.has(state.nextBuildingId)) state.nextBuildingId++;
                    id = state.nextBuildingId++;
                }
                usedIds.add(id);
                const linkedNodeId = Number.isInteger(rec.linkedNodeId) && world.nodes[rec.linkedNodeId] && !world.nodes[rec.linkedNodeId].occupied ? rec.linkedNodeId : null;
                const linkedVentId = Number.isInteger(rec.linkedVentId) && world.vents[rec.linkedVentId] && !world.vents[rec.linkedVentId].occupied ? rec.linkedVentId : null;
                const b = {
                    id, kind: 'building', type: rec.type,
                    name: typeof rec.name === 'string' ? rec.name.slice(0, 64) : def.name,
                    position: pos, mesh,
                    power: Number.isFinite(rec.power) ? rec.power : def.power,
                    level: Math.max(1, Math.min(3, Number.isInteger(rec.level) ? rec.level : 1)),
                    inputBuffer: cleanBuffer(rec.inputBuffer),
                    outputBuffer: cleanBuffer(rec.outputBuffer),
                    recipe: D.SMELTER_RECIPES[rec.recipe] ? rec.recipe : (def.type === 'smelter' ? 'titaniumIngot' : null),
                    progress: U.clamp(Number.isFinite(rec.progress) ? rec.progress : 0, 0, 120),
                    linkedNodeId,
                    linkedVentId,
                    depleted: false, scanTimer: 0
                };
                if (linkedNodeId !== null) world.nodes[linkedNodeId].occupied = true;
                if (linkedVentId !== null) world.vents[linkedVentId].occupied = true;
                mesh.traverse(c => { if (c.isMesh && !c.userData.noPick) c.userData.entity = b; });
                applyLevelVisual(b);
                state.buildings.push(b);
                api.interactables.push(mesh);
                state.nextBuildingId = Math.max(state.nextBuildingId, id + 1);
                if (b.type === 'droneBay') spawnDrone(b);
            });
            recalcPower();
        };

        api.restorePipes = function (records) {
            if (!Array.isArray(records)) return;
            records.slice(0, 200).forEach(rec => {
                if (!rec || typeof rec !== 'object') return;
                const from = state.buildings.find(b => b.id === rec.fromId);
                const to = state.buildings.find(b => b.id === rec.toId);
                if (!from || !to) return;
                if (state.pipes.some(p => p.fromId === from.id && p.toId === to.id)) return;
                const pipe = createPipe(from, to);
                pipe.carrying = D.RESOURCES[rec.carrying] ? rec.carrying : null;
                pipe.transit = pipe.carrying ? U.clamp(Number(rec.transit) || 0, 0, 1) : 0;
                pipe.packetMesh.visible = !!pipe.carrying;
                if (pipe.carrying) pipe.packetMesh.position.copy(pipe.curve.getPoint(pipe.transit));
            });
        };

        api.spawnHub = spawnHub;
        api.createMesh = createMesh;
        api.recalcPower = recalcPower;

        return api;
    }

    return { create };
})();
