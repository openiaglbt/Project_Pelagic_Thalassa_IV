/* ============================================================================
 * world.js — Génération et rendu du monde de Thalassa-IV
 * 6 400 × 6 400 m, 11 régions, terrain LOD par chunks, flore instanciée.
 * ==========================================================================*/
window.PP = window.PP || {};

PP.World = (function () {
    'use strict';

    const D = PP.Data;
    const U = D.UTILS;
    const W = D.WORLD;

    const TERRAIN_PALETTE = {
        kelp:      { top: '#123f3f', deep: '#08252e', rock: '#1b4a42', accent: '#34d399' },
        crystal:   { top: '#0e3450', deep: '#071f38', rock: '#1c4d68', accent: '#38bdf8' },
        frozen:    { top: '#133c49', deep: '#092633', rock: '#215465', accent: '#a5f3fc' },
        metropolis:{ top: '#1b302a', deep: '#0c1c19', rock: '#3d3627', accent: '#fbbf24' },
        volcanic:  { top: '#2b1811', deep: '#140a06', rock: '#42231b', accent: '#fb7185' },
        hydro:     { top: '#28170f', deep: '#110805', rock: '#43251a', accent: '#fb923c' },
        graveyard: { top: '#161329', deep: '#080713', rock: '#2a2445', accent: '#c4b5fd' },
        labyrinth: { top: '#1a132b', deep: '#0a0716', rock: '#312348', accent: '#a78bfa' },
        midnight:  { top: '#0e0717', deep: '#040208', rock: '#1c1029', accent: '#e879f9' },
        maw:       { top: '#140719', deep: '#050107', rock: '#260d33', accent: '#f0abfc' },
        rift:      { top: '#0a1018', deep: '#030508', rock: '#16202b', accent: '#64748b' }
    };

    /* ------------------------------------------------------------------ */
    /* UTILITAIRES GÉOMÉTRIQUES                                            */
    /* ------------------------------------------------------------------ */
    function colorize(geo, color, variance = 0.06) {
        const base = new THREE.Color(color);
        const count = geo.attributes.position.count;
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const v = 1 + (Math.random() - 0.5) * variance * 2;
            colors[i * 3] = Math.min(1, base.r * v);
            colors[i * 3 + 1] = Math.min(1, base.g * v);
            colors[i * 3 + 2] = Math.min(1, base.b * v);
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        return geo;
    }

    /* Dégradé vertical sur un morceau : une feuille sombre à la base et
       lumineuse au sommet lit beaucoup mieux qu'une couleur uniforme. */
    function gradientize(geo, bottom, top, variance = 0.05) {
        const colors = geo.attributes.color;
        const pos = geo.attributes.position;
        if (!colors || !pos) return geo;
        const low = new THREE.Color(bottom), high = new THREE.Color(top), col = new THREE.Color();
        let minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        const span = maxY - minY || 1;
        for (let i = 0; i < pos.count; i++) {
            const t = U.clamp((pos.getY(i) - minY) / span, 0, 1);
            col.copy(low).lerp(high, t);
            const v = 1 + (Math.random() - 0.5) * variance * 2;
            colors.setXYZ(i, Math.min(1, col.r * v), Math.min(1, col.g * v), Math.min(1, col.b * v));
        }
        colors.needsUpdate = true;
        return geo;
    }

    function makeBladeGeometry(width, height, curve) {
        const geo = new THREE.PlaneGeometry(width, height, 2, 5);
        geo.translate(0, height / 2, 0);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const t = U.clamp(pos.getY(i) / height, 0, 1);
            pos.setX(i, pos.getX(i) * (1 - 0.62 * t));
            pos.setZ(i, Math.sin(t * Math.PI) * curve);
        }
        geo.computeVertexNormals();
        return geo;
    }

    function mergeGeometries(list) {
        let total = 0;
        const converted = list.map(g => {
            const ng = g.index ? g.toNonIndexed() : g;
            total += ng.attributes.position.count;
            return ng;
        });
        const pos = new Float32Array(total * 3);
        const norm = new Float32Array(total * 3);
        const col = new Float32Array(total * 3);
        let offset = 0;
        converted.forEach(g => {
            const p = g.attributes.position;
            const n = g.attributes.normal;
            const c = g.attributes.color;
            for (let i = 0; i < p.count; i++) {
                pos[(offset + i) * 3] = p.getX(i);
                pos[(offset + i) * 3 + 1] = p.getY(i);
                pos[(offset + i) * 3 + 2] = p.getZ(i);
                if (n) {
                    norm[(offset + i) * 3] = n.getX(i);
                    norm[(offset + i) * 3 + 1] = n.getY(i);
                    norm[(offset + i) * 3 + 2] = n.getZ(i);
                }
                if (c) {
                    col[(offset + i) * 3] = c.getX(i);
                    col[(offset + i) * 3 + 1] = c.getY(i);
                    col[(offset + i) * 3 + 2] = c.getZ(i);
                }
            }
            offset += p.count;
        });
        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
        out.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return out;
    }

    function addPart(list, geo, color, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
        colorize(geo, color);
        const m = new THREE.Matrix4();
        m.compose(
            new THREE.Vector3(x, y, z),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
            new THREE.Vector3(sx, sy, sz)
        );
        geo.applyMatrix4(m);
        list.push(geo);
        return geo;
    }

    function makeGlowTexture() {
        const c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        const ctx = c.getContext('2d');
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(c);
    }

    /* Halo doux pour les particules : évite les carrés lumineux du
       PointsMaterial par défaut, qui trahissent immédiatement le rendu. */
    function makeSoftParticleTexture() {
        const c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        const ctx = c.getContext('2d');
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.35, 'rgba(255,255,255,0.72)');
        grad.addColorStop(0.72, 'rgba(255,255,255,0.18)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(c);
    }

    /* Faisceau de lumière : dégradé vertical depuis la surface et
       effilochage horizontal, pour des rais doux au lieu de cônes solides. */
    function makeShaftTexture() {
        const w = 96, h = 512;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(w, h);
        const data = img.data;
        for (let y = 0; y < h; y++) {
            const v = y / h;
            const vertical = Math.pow(1 - v, 1.55) * (0.55 + 0.45 * Math.sin(v * Math.PI));
            for (let x = 0; x < w; x++) {
                const u = x / w;
                const edge = Math.pow(Math.max(0, 1 - Math.abs(u - 0.5) * 2), 2.1);
                const strand = 0.62 + 0.38 * Math.sin(u * 31.0 + v * 5.0) * Math.sin(u * 13.0 - v * 11.0);
                const a = Math.max(0, vertical * edge * strand);
                const i = (y * w + x) * 4;
                data[i] = 185; data[i + 1] = 238; data[i + 2] = 255;
                data[i + 3] = Math.round(a * 255);
            }
        }
        ctx.putImageData(img, 0, 0);
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        return tex;
    }

    /* Peau organique du cœur de la Gueule : taches, membranes et réseau
       veineux émissif. Une texture porte le détail bien plus loin qu'une
       géométrie de veines de quelques centimètres. */
    function makeHeartTexture() {
        const c = document.createElement('canvas');
        c.width = 512; c.height = 256;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#3a1055';
        ctx.fillRect(0, 0, 512, 256);
        for (let i = 0; i < 70; i++) {
            const x = Math.random() * 512, y = Math.random() * 256;
            const r = 8 + Math.random() * 46;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            const bright = Math.random() < 0.45;
            g.addColorStop(0, bright ? 'rgba(192,112,255,.42)' : 'rgba(78,26,104,.38)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.lineCap = 'round';
        ctx.shadowColor = 'rgba(240,171,252,.9)';
        for (let i = 0; i < 18; i++) {
            let x = Math.random() * 512, y = Math.random() * 256;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.shadowBlur = 5 + Math.random() * 7;
            ctx.strokeStyle = `rgba(240,171,252,${0.32 + Math.random() * 0.4})`;
            ctx.lineWidth = 1.2 + Math.random() * 2.4;
            for (let s = 0; s < 9; s++) {
                x += (Math.random() - 0.5) * 34;
                y += (Math.random() - 0.35) * 26;
                ctx.lineTo(x, y);
            }
            ctx.stroke();
            // Ramifications courtes
            for (let b = 0; b < 2; b++) {
                const bx = x, by = y;
                ctx.beginPath(); ctx.moveTo(bx, by);
                ctx.lineWidth = 0.8 + Math.random() * 1.2;
                ctx.lineTo(bx + (Math.random() - 0.5) * 46, by + (Math.random() - 0.5) * 40);
                ctx.stroke();
            }
        }
        ctx.shadowBlur = 0;
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.encoding = THREE.sRGBEncoding;
        return tex;
    }

    /* Texture de sédiment : grain fin, galets et stries, multipliée par les
       couleurs de vertex du terrain pour casser l'aspect « plastique ». */
    function makeSeabedTexture(size) {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        // Base volontairement sourde : une texture claire, multipliée par la
        // lumière, transformait le fond en nappe laiteuse.
        ctx.fillStyle = '#928c7f';
        ctx.fillRect(0, 0, size, size);

        // Grandes taches de sédiment, volontairement irrégulières : des
        // ellipses qui se chevauchent plutôt qu'un semis de bulles rondes.
        for (let i = 0; i < 22; i++) {
            const x = Math.random() * size, y = Math.random() * size;
            const rx = 18 + Math.random() * 58;
            const ry = rx * (0.35 + Math.random() * 0.55);
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(rx, ry));
            g.addColorStop(0, 'rgba(48,48,43,.10)');
            g.addColorStop(1, 'rgba(48,48,43,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(0, 0, Math.max(rx, ry), 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }

        // Grain fin
        const img = ctx.getImageData(0, 0, size, size);
        const data = img.data;
        for (let i = 0; i < data.length; i += 4) {
            const n = (Math.random() - 0.5) * 20;
            data[i] = U.clamp(data[i] + n, 0, 255);
            data[i + 1] = U.clamp(data[i + 1] + n, 0, 255);
            data[i + 2] = U.clamp(data[i + 2] + n, 0, 255);
        }
        ctx.putImageData(img, 0, 0);

        // Galets et éclats de roche
        for (let i = 0; i < size * 1.6; i++) {
            const x = Math.random() * size, y = Math.random() * size;
            const r = 0.4 + Math.random() * 1.9;
            const v = 78 + Math.floor(Math.random() * 82);
            ctx.fillStyle = `rgba(${v},${v - 4},${v - 12},${0.18 + Math.random() * 0.32})`;
            ctx.beginPath();
            ctx.ellipse(x, y, r, r * (0.55 + Math.random() * 0.5), Math.random() * Math.PI, 0, Math.PI * 2);
            ctx.fill();
        }

        // Failles sédimentaires discrètes
        ctx.strokeStyle = 'rgba(58,56,50,.24)';
        ctx.lineWidth = 0.7;
        for (let i = 0; i < 9; i++) {
            ctx.beginPath();
            let x = Math.random() * size, y = Math.random() * size;
            ctx.moveTo(x, y);
            for (let s = 0; s < 7; s++) {
                x += (Math.random() - 0.5) * 34;
                y += 9 + Math.random() * 16;
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(11, 11);
        tex.encoding = THREE.sRGBEncoding;
        tex.anisotropy = 8;
        return tex;
    }

    function makeNoiseTexture(size, repeat) {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(size, size);
        // Relief fractal doux : plus de galets ronds en relief, seulement
        // des ondulations de sédiment et des rides de courant.
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const n = U.fbm(x * 0.028 + 11.3, y * 0.028 - 4.7, 4) * 0.70 +
                    U.fbm(x * 0.11 - 2.1, y * 0.11 + 9.4, 2) * 0.30;
                const ripple = Math.sin((x + y * 0.55) * 0.045 + n * 5.0) * 0.06;
                const v = U.clamp(96 + n * 108 + ripple * 255, 0, 255);
                const i = (y * size + x) * 4;
                img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeat, repeat);
        tex.anisotropy = 8;
        return tex;
    }

    /* ------------------------------------------------------------------ */
    /* CRÉATION DU MONDE                                                   */
    /* ------------------------------------------------------------------ */
    // Cède le fil au navigateur pour peindre la progression. Si l'onglet est
    // occulté, requestAnimationFrame est suspendu : un MessageChannel sert de
    // repli immédiat (non soumis au throttling des timers d'arrière-plan).
    const yieldChannel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
    function nextFrame() {
        return new Promise(resolve => {
            let settled = false;
            const finish = () => { if (!settled) { settled = true; resolve(); } };
            requestAnimationFrame(finish);
            if (yieldChannel) {
                yieldChannel.port1.onmessage = finish;
                yieldChannel.port2.postMessage(0);
            } else {
                setTimeout(finish, 30);
            }
        });
    }

    function create(scene, quality) {
        const q = quality || D.QUALITY_PRESETS.high;
        const api = {
            scene, quality: q,
            chunks: [], nodes: [], vents: [], pois: [], relics: [], landmarks: [],
            nodeMeshes: [], nodeRingMeshes: [], nodeLookup: new Map(),
            floraMeshes: [], schools: [], mantas: [], jellies: [], predators: [],
            speciesSightings: {}, animated: [], mapCanvas: null, megafauna: [],
            salvage: [], currentRibbons: [],
            selectionRing: null, weaver: null, silkLine: null, tetherTarget: null,
            water: null, plankton: null, snow: null, bubblePoints: null,
            rays: null, sky: null, skyMat: null, glowTex: makeGlowTexture(), time: 0
        };

        /* ---------------------------- TERRAIN ---------------------------- */
        function height(x, z) {
            const r = Math.hypot(x, z);
            let base = 8 - 250 * Math.pow(U.smoothstep(440, 3240, r), 1.15);
            base -= U.smoothstep(2900, 3320, r) * 105;
            let sumW = 0.72, sumH = base * 0.72;

            for (let i = 0; i < D.REGIONS.length; i++) {
                const reg = D.REGIONS[i];
                if (reg.id === 'rift') continue;
                const d = Math.hypot(x - reg.center[0], z - reg.center[1]) / reg.radius;
                if (d < 1.65) {
                    const w = Math.pow(1 - U.smoothstep(0.28, 1.5, d), 1.45) * reg.pull * 2.1;
                    sumH += (reg.height || 0) * w;
                    sumW += w;
                }
            }
            let h = sumH / sumW;

            const ridge = (U.fbm(x * 0.00095 + 4.2, z * 0.00095 - 9.1, 4) - 0.5) * 34;
            const detail = (U.fbm(x * 0.0046 - 3.7, z * 0.0046 + 8.3, 3) - 0.5) * 6.5;
            h += ridge * (0.55 + U.smoothstep(220, 1800, r)) + detail;

            // Fosse de Minuit : entaille linéaire profonde
            const t = trenchFactor(x, z, 470, -1960, 90, -3030, 116);
            h -= t * 92;
            // Faille périphérique ouverte au sud-ouest
            const t2 = trenchFactor(x, z, -2900, -400, -1960, -2360, 88);
            h -= t2 * 54;

            // Rayonnement central : mer de kelp abritée
            const plain = 1 - U.smoothstep(180, 680, Math.hypot(x, z - 120));
            h = U.lerp(h, 6.0, plain * (1 - U.smoothstep(110, 240, Math.hypot(x, z))));

            // Plateforme de départ parfaitement stable
            const hub = 1 - U.smoothstep(76, 230, r);
            h = U.lerp(h, W.START_Y, hub * 0.985);

            return h;
        }

        function trenchFactor(x, z, ax, az, bx, bz, radius) {
            const vx = bx - ax, vz = bz - az;
            const wx = x - ax, wz = z - az;
            const len2 = vx * vx + vz * vz;
            const t = U.clamp((wx * vx + wz * vz) / len2, 0, 1);
            const px = ax + vx * t, pz = az + vz * t;
            const d = Math.hypot(x - px, z - pz) / radius;
            return Math.exp(-d * d * 2.2);
        }

        function regionAt(x, z) {
            let best = D.REGION_BY_ID.kelp;
            let bestScore = Infinity;
            for (let i = 0; i < D.REGIONS.length; i++) {
                const reg = D.REGIONS[i];
                if (reg.id === 'rift') continue;
                const d = Math.hypot(x - reg.center[0], z - reg.center[1]) / reg.radius;
                if (d < bestScore) { bestScore = d; best = reg; }
            }
            const r = Math.hypot(x, z);
            if (bestScore > 1.12 && r > 2640) return D.REGION_BY_ID.rift;
            return best;
        }

        function depthOf(y) {
            return Math.max(0, Math.round((W.WATER_Y - y) * W.DEPTH_SCALE));
        }
        function depthAt(x, z) { return depthOf(height(x, z)); }
        function yForDepth(depth) { return W.WATER_Y - depth / W.DEPTH_SCALE; }
        function slopeAt(x, z) {
            const e = 4.4;
            const hL = height(x - e, z), hR = height(x + e, z);
            const hD = height(x, z - e), hU = height(x, z + e);
            return Math.hypot(hR - hL, hU - hD) / (2 * e);
        }

        api.height = height;
        api.regionAt = regionAt;
        api.depthOf = depthOf;
        api.depthAt = depthAt;
        api.yForDepth = yForDepth;
        api.slopeAt = slopeAt;

        /* -------------------------- ATMOSPHÈRE -------------------------- */
        /* Une voûte de brume dégradée remplace l'aplat de couleur : elle donne
           une verticalité à la colonne d'eau et colore l'horizon sans jamais
           révéler de bord. Le dôme suit la caméra et ne reçoit pas le fog. */
        function buildAtmosphere() {
            const geo = new THREE.SphereGeometry(5600, 32, 20);
            const mat = new THREE.ShaderMaterial({
                side: THREE.BackSide,
                depthWrite: false,
                fog: false,
                uniforms: {
                    uTop: { value: new THREE.Color(0x031a28) },
                    uHorizon: { value: new THREE.Color(0x073247) },
                    uAccent: { value: new THREE.Color(0x22d3ee) },
                    uTime: { value: 0 },
                    uDepth: { value: 0 },
                    uSunDir: { value: new THREE.Vector3(0.34, 0.80, 0.49).normalize() }
                },
                vertexShader: `
                    varying vec3 vDir;
                    void main() {
                        vDir = normalize(position);
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform vec3 uTop;
                    uniform vec3 uHorizon;
                    uniform vec3 uAccent;
                    uniform vec3 uSunDir;
                    uniform float uTime;
                    uniform float uDepth;
                    varying vec3 vDir;
                    void main() {
                        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
                        // Le dégradé part exactement de la couleur de brume à
                        // l'horizon : le relief lointain s'y fond sans arête.
                        vec3 col = mix(uHorizon, uTop, smoothstep(0.46, 0.94, h));
                        float band = pow(1.0 - abs(vDir.y), 9.0);
                        col = mix(col, uAccent, band * 0.08);
                        float shimmer = sin(vDir.x * 23.0 + uTime * 0.14) * sin(vDir.z * 19.0 - uTime * 0.11);
                        col += uAccent * (0.004 + max(0.0, shimmer) * 0.005);
                        // Soleil diffusé par la colonne d'eau : un halo large
                        // et un disque net, tous deux éteints avec la profondeur.
                        float sunAlign = max(dot(vDir, normalize(uSunDir)), 0.0);
                        float halo = pow(sunAlign, 6.0);
                        float disc = pow(sunAlign, 420.0);
                        float surface = 1.0 - uDepth;
                        col += vec3(0.10, 0.30, 0.38) * halo * 0.12 * surface;
                        col += vec3(0.62, 0.92, 1.00) * disc * 0.55 * surface;
                        gl_FragColor = vec4(col, 1.0);
                    }
                `
            });
            const dome = new THREE.Mesh(geo, mat);
            dome.renderOrder = -10;
            dome.frustumCulled = false;
            scene.add(dome);
            api.sky = dome;
            api.skyMat = mat;
        }

        /* ---------------------------- EAU ------------------------------- */
        function buildWater() {
            // La surface dépasse largement la portée de la caméra : son bord
            // ne doit jamais apparaître comme une ligne d'horizon artificielle.
            const geo = new THREE.PlaneGeometry(20000, 20000, 64, 64);
            const mat = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uColorA: { value: new THREE.Color(0x0a3d57) },
                    uColorB: { value: new THREE.Color(0x2a93a8) },
                    uFogColor: { value: new THREE.Color(0x042838) },
                    uSurfaceFade: { value: 1.0 }
                },
                vertexShader: `
                    uniform float uTime;
                    varying vec3 vWorld;
                    varying float vWave;
                    void main() {
                        vec3 p = position;
                        float w = sin((p.x + uTime * 9.0) * 0.018) * cos((p.y - uTime * 6.0) * 0.021);
                        float w2 = sin((p.x + uTime * 15.0) * 0.042 + p.y * 0.011) * cos((p.y - uTime * 11.0) * 0.037);
                        p.z += w * 1.15 + w2 * 0.55;
                        vWave = w * 0.72 + w2 * 0.28;
                        vec4 wp = modelMatrix * vec4(p, 1.0);
                        vWorld = wp.xyz;
                        gl_Position = projectionMatrix * viewMatrix * wp;
                    }
                `,
                fragmentShader: `
                    uniform float uTime;
                    uniform vec3 uColorA;
                    uniform vec3 uColorB;
                    uniform vec3 uFogColor;
                    uniform float uSurfaceFade;
                    varying vec3 vWorld;
                    varying float vWave;
                    void main() {
                        float bands = 0.5 + 0.5 * sin(vWorld.x * 0.021 + uTime * 0.55) * sin(vWorld.z * 0.017 - uTime * 0.42);
                        float w1 = 0.5 + 0.5 * sin(vWorld.x * 0.073 + uTime * 0.80) * sin(vWorld.z * 0.061 - uTime * 0.62);
                        float w2 = 0.5 + 0.5 * sin(vWorld.x * 0.113 - uTime * 0.51) * sin(vWorld.z * 0.091 + uTime * 0.73);
                        float caustic = pow(w1, 2.0) * pow(w2, 2.0);
                        float fine = 0.5 + 0.5 * sin(vWorld.x * 0.16 - vWorld.z * 0.11 + uTime * 0.9);
                        vec3 col = mix(uColorA, uColorB, bands * 0.42 + caustic * 0.38 + fine * 0.05);
                        col += vec3(0.06, 0.22, 0.24) * caustic;
                        // Reflet de la surface : le regard rasant accroche une
                        // lame claire, comme une vraie interface air/eau.
                        vec3 viewVec = normalize(cameraPosition - vWorld);
                        float fresnel = pow(1.0 - clamp(abs(viewVec.y), 0.0, 1.0), 3.0);
                        float glint = pow(caustic, 2.0) * (0.22 + fresnel * 1.35);
                        col += vec3(0.42, 0.74, 0.82) * glint;
                        float alpha = 0.50 + vWave * 0.05 + caustic * 0.10 + fresnel * 0.12;
                        // Fondu vers la brume de région : la surface rejoint
                        // l'horizon sans arête visible.
                        float dist = length(vWorld - cameraPosition);
                        // La surface s'efface dans la brume avant l'horizon :
                        // plus de ruban néon coupant la colonne d'eau.
                        float fog = smoothstep(130.0, 720.0, dist);
                        col = mix(col, uFogColor, fog);
                        alpha = alpha * (1.0 - smoothstep(220.0, 760.0, dist)) * uSurfaceFade;
                        gl_FragColor = vec4(col, alpha);
                    }
                `,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.y = W.WATER_Y;
            mesh.renderOrder = 2;
            scene.add(mesh);
            api.water = mesh;
        }

        /* ------------------------- RAYONS DE LUMIÈRE --------------------- */
        function buildGodRays() {
            const group = new THREE.Group();
            const geo = new THREE.PlaneGeometry(1, 1);
            const tex = makeShaftTexture();
            const count = q.shadows ? 26 : 9;
            for (let i = 0; i < count; i++) {
                const width = 22 + Math.random() * 58;
                const height = 150 + Math.random() * 150;
                const mat = new THREE.MeshBasicMaterial({
                    map: tex, color: i % 4 === 0 ? 0xd9fff4 : 0x9be8ff, transparent: true,
                    opacity: 0.10 + Math.random() * 0.08,
                    side: THREE.DoubleSide, depthWrite: false,
                    blending: THREE.AdditiveBlending
                });
                const ray = new THREE.Mesh(geo, mat);
                ray.scale.set(width, height, 1);
                ray.position.set(
                    (Math.random() - 0.5) * 560,
                    W.WATER_Y - height / 2 - 2,
                    (Math.random() - 0.5) * 500
                );
                ray.rotation.y = Math.random() * Math.PI;
                ray.rotation.z = (Math.random() - 0.5) * 0.14;
                ray.userData.baseOpacity = mat.opacity;
                ray.userData.baseRotZ = ray.rotation.z;
                group.add(ray);
            }
            scene.add(group);
            api.rays = group;
            api.rayTex = tex;
        }

        /* --------------------------- PARTICULES ------------------------- */
        /* Particules à sprite doux, taille en pixels maîtrisée : plus de
           carrés géants quand la caméra traverse un banc de plancton. */
        function makeParticleMaterial(color, opacity) {
            return new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uColor: { value: new THREE.Color(color) },
                    uOpacity: { value: opacity }
                },
                vertexShader: `
                    attribute float aSize;
                    attribute float aPhase;
                    uniform float uTime;
                    varying float vTwinkle;
                    varying float vNear;
                    void main() {
                        vec4 mv = modelViewMatrix * vec4(position, 1.0);
                        float depth = max(0.6, -mv.z);
                        gl_PointSize = clamp(aSize * (260.0 / depth), 0.7, 10.0);
                        vTwinkle = 0.55 + 0.45 * sin(uTime * 1.25 + aPhase);
                        vNear = smoothstep(0.4, 2.6, depth);
                        gl_Position = projectionMatrix * mv;
                    }
                `,
                fragmentShader: `
                    uniform vec3 uColor;
                    uniform float uOpacity;
                    varying float vTwinkle;
                    varying float vNear;
                    void main() {
                        vec2 d = gl_PointCoord - vec2(0.5);
                        float r = length(d) * 2.0;
                        if (r > 1.0) discard;
                        float a = pow(1.0 - r, 1.8) * uOpacity * vTwinkle * vNear;
                        gl_FragColor = vec4(uColor, a);
                    }
                `,
                transparent: true, depthWrite: false,
                blending: THREE.AdditiveBlending
            });
        }

        function buildParticles() {
            const count = Math.floor(2100 * q.particles);
            const pos = new Float32Array(count * 3);
            const size = new Float32Array(count);
            const phase = new Float32Array(count);
            for (let i = 0; i < count; i++) {
                pos[i * 3] = (Math.random() - 0.5) * 240;
                pos[i * 3 + 1] = (Math.random() - 0.5) * 140;
                pos[i * 3 + 2] = (Math.random() - 0.5) * 240;
                size[i] = 0.10 + Math.random() * 0.30;
                phase[i] = Math.random() * Math.PI * 2;
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
            geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
            const mat = makeParticleMaterial(0x9be8ff, 0.62);
            const points = new THREE.Points(geo, mat);
            points.frustumCulled = false;
            scene.add(points);
            api.plankton = points;
            api.planktonMat = mat;

            const snowCount = Math.floor(1400 * q.particles);
            const sPos = new Float32Array(snowCount * 3);
            const sSize = new Float32Array(snowCount);
            const sPhase = new Float32Array(snowCount);
            for (let i = 0; i < snowCount; i++) {
                sPos[i * 3] = (Math.random() - 0.5) * 500;
                sPos[i * 3 + 1] = (Math.random() - 0.5) * 300;
                sPos[i * 3 + 2] = (Math.random() - 0.5) * 500;
                sSize[i] = 0.08 + Math.random() * 0.20;
                sPhase[i] = Math.random() * Math.PI * 2;
            }
            const sGeo = new THREE.BufferGeometry();
            sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
            sGeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1));
            sGeo.setAttribute('aPhase', new THREE.BufferAttribute(sPhase, 1));
            const sMat = makeParticleMaterial(0xbae6fd, 0.32);
            const snow = new THREE.Points(sGeo, sMat);
            snow.frustumCulled = false;
            scene.add(snow);
            api.snow = snow;
            api.snowMat = sMat;
        }

        /* ---------------------------- TERRAIN --------------------------- */
        const CHUNK_COUNT = 20;
        const CHUNK_SIZE = W.SIZE / CHUNK_COUNT;
        const HUB_CLEAR_RADIUS = 92;
        // Horloge partagée par tous les matériaux de fond : une seule valeur
        // à mettre à jour pour animer les caustiques de toute la carte.
        const causticUniform = { value: 0 };

        function createChunk(cx, cz, segments, isLow) {
            const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, segments, segments);
            geo.rotateX(-Math.PI / 2);
            const pos = geo.attributes.position;
            const colors = new Float32Array(pos.count * 3);
            for (let i = 0; i < pos.count; i++) {
                const lx = pos.getX(i), lz = pos.getZ(i);
                pos.setY(i, height(cx + lx, cz + lz));
            }
            geo.computeVertexNormals();
            const normals = geo.attributes.normal;
            const baseX = cx, baseZ = cz;
            for (let i = 0; i < pos.count; i++) {
                const wx = baseX + pos.getX(i);
                const wz = baseZ + pos.getZ(i);
                const h = pos.getY(i);
                const depth = depthOf(h);
                const reg = regionAt(wx, wz);
                const pal = TERRAIN_PALETTE[reg.id] || TERRAIN_PALETTE.kelp;
                const deepT = U.clamp((depth - 60) / 2300, 0, 1);
                const slope = 1 - Math.abs(normals.getY(i));
                const noise = U.fbm(wx * 0.031, wz * 0.031, 2);
                const macro = U.fbm(wx * 0.0042, wz * 0.0042, 3);
                const micro = U.fbm(wx * 0.13, wz * 0.13, 2);
                let col = new THREE.Color(pal.top);
                col.lerp(new THREE.Color(pal.deep), deepT * 0.9);
                // Patchs de sédiment et affleurements rocheux à grande échelle
                col.lerp(new THREE.Color(macro > 0.52 ? pal.rock : pal.deep), Math.abs(macro - 0.5) * 0.55);
                col.lerp(new THREE.Color(pal.rock), U.clamp(slope * 2.2, 0, 0.85));
                // Rides de courant et voiles d'algue : la plaine cesse d'être
                // une nappe uniforme sans exiger un nouveau maillage.
                const ripple = 0.5 + 0.5 * Math.sin(wx * 0.36 + wz * 0.23 + macro * 7.0);
                const algae = U.smoothstep(0.54, 0.88, macro) * (reg.id === 'kelp' || reg.id === 'hydro' ? 0.20 : 0.10);
                col.lerp(new THREE.Color(pal.accent), algae * 0.7);
                col.multiplyScalar(0.90 + ripple * 0.12 + (noise - 0.5) * 0.18);
                const shade = 0.84 + noise * 0.22 + micro * 0.15 + (macro - 0.5) * 0.20;
                colors[i * 3] = col.r * shade;
                colors[i * 3 + 1] = col.g * shade;
                colors[i * 3 + 2] = col.b * shade;
            }
            geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            const seabedMap = api.seabedTex || (api.seabedTex = makeSeabedTexture(512));
            const seabedBump = api.seabedBump || (api.seabedBump = makeNoiseTexture(256, 8));
            seabedMap.wrapS = seabedMap.wrapT = THREE.RepeatWrapping;
            seabedBump.wrapS = seabedBump.wrapT = THREE.RepeatWrapping;
            // Le relief de sédiment doit se lire à l'échelle d'un pas, pas
            // d'un quart de chunk : on serre la répétition du bump seul.
            seabedBump.repeat.set(28, 28);
            const mat = new THREE.MeshStandardMaterial({
                vertexColors: true,
                roughness: 0.9,
                metalness: 0.05,
                map: seabedMap,
                bumpMap: seabedBump,
                bumpScale: 0.55,
                roughnessMap: seabedBump,
                envMapIntensity: 0.4
            });
            // Caustiques de surface : la lumière du soleil se concentre en
            // résilles sur les hauts-fonds. Le motif suit la position monde,
            // donc il reste continu d'un chunk à l'autre.
            if (q.quality === 'high' || q.quality === 'ultra') {
                mat.onBeforeCompile = shader => {
                    shader.uniforms.uCausticTime = causticUniform;
                    mat.userData.shader = shader;
                    shader.vertexShader = 'varying vec3 vCausticWorld;\n' + shader.vertexShader;
                    shader.vertexShader = shader.vertexShader.replace(
                        '#include <begin_vertex>',
                        '#include <begin_vertex>\nvCausticWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;'
                    );
                    shader.fragmentShader = 'varying vec3 vCausticWorld;\nuniform float uCausticTime;\n' + shader.fragmentShader;
                    shader.fragmentShader = shader.fragmentShader.replace(
                        '#include <color_fragment>',
                        `#include <color_fragment>
                        float causticShallow = smoothstep(-120.0, -4.0, vCausticWorld.y);
                        float c1 = sin(vCausticWorld.x * 0.36 + uCausticTime * 0.85) * sin(vCausticWorld.z * 0.31 - uCausticTime * 0.66);
                        float c2 = sin(vCausticWorld.x * 0.71 - uCausticTime * 1.18) * sin(vCausticWorld.z * 0.64 + uCausticTime * 0.94);
                        float causticMask = pow(clamp(c1 * 0.5 + 0.5, 0.0, 1.0), 3.0) * pow(clamp(c2 * 0.5 + 0.5, 0.0, 1.0), 2.0);
                        diffuseColor.rgb += diffuseColor.rgb * causticMask * causticShallow * 0.95;`
                    );
                };
                mat.customProgramCacheKey = () => 'terrain-caustics';
            }
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(cx, 0, cz);
            mesh.receiveShadow = !isLow && q.shadows;
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
            scene.add(mesh);
            return mesh;
        }

        /* Muraille de la Faille Périphérique : ferme le bassin pour que le
           bord du monde soit un relief praticable, pas un vide noir. */
        function buildRiftWall() {
            const radius = W.HALF + 30;
            const geo = new THREE.CylinderGeometry(radius, radius * 0.94, 1200, 96, 1, true);
            const mat = new THREE.MeshStandardMaterial({
                color: 0x0b141d,
                roughness: 0.94,
                metalness: 0.08,
                map: api.seabedTex || (api.seabedTex = makeSeabedTexture(256)),
                side: THREE.BackSide
            });
            if (mat.map) {
                mat.map = mat.map.clone();
                mat.map.needsUpdate = true;
                mat.map.repeat.set(48, 5);
            }
            const wall = new THREE.Mesh(geo, mat);
            wall.position.y = -460;
            wall.receiveShadow = false;
            wall.castShadow = false;
            wall.matrixAutoUpdate = false;
            wall.updateMatrix();
            scene.add(wall);
            api.riftWall = wall;

            // Crêtes rocheuses qui accrochent la lumière le long de la paroi.
            const ridgeGeo = new THREE.ConeGeometry(26, 160, 5);
            const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x111c26, roughness: 0.96, metalness: 0.05 });
            const ridges = new THREE.InstancedMesh(ridgeGeo, ridgeMat, 96);
            const m = new THREE.Matrix4();
            const quat = new THREE.Quaternion();
            const scale = new THREE.Vector3();
            for (let i = 0; i < 96; i++) {
                const a = (i / 96) * Math.PI * 2 + (Math.random() - 0.5) * 0.06;
                const r = radius - 12 - Math.random() * 26;
                const x = Math.cos(a) * r;
                const z = Math.sin(a) * r;
                const y = height(x, z) - 20 + Math.random() * 30;
                quat.setFromEuler(new THREE.Euler(0, a + Math.PI, 0));
                scale.set(0.7 + Math.random() * 1.3, 0.7 + Math.random() * 1.7, 0.7 + Math.random() * 1.3);
                m.compose(new THREE.Vector3(x, y, z), quat, scale);
                ridges.setMatrixAt(i, m);
            }
            ridges.instanceMatrix.needsUpdate = true;
            ridges.frustumCulled = false;
            scene.add(ridges);
            api.riftRidges = ridges;
        }

        async function buildTerrain(onProgress) {
            const total = CHUNK_COUNT * CHUNK_COUNT;
            let done = 0;
            for (let cz = -W.HALF + CHUNK_SIZE / 2; cz < W.HALF; cz += CHUNK_SIZE) {
                for (let cx = -W.HALF + CHUNK_SIZE / 2; cx < W.HALF; cx += CHUNK_SIZE) {
                    const segments = q.quality === 'low' ? 20 : 30;
                    const high = createChunk(cx, cz, segments, false);
                    const low = createChunk(cx, cz, 9, true);
                    low.visible = false;
                    const distToHub = Math.hypot(cx, cz);
                    const chunk = {
                        cx, cz, high, low,
                        distance: 0,
                        near: distToHub < 400,
                        lastVisible: true
                    };
                    api.chunks.push(chunk);
                    done++;
                    if (done % 8 === 0) {
                        if (onProgress) onProgress(0.08 + 0.52 * (done / total), 'Cartographie bathymétrique');
                        // Même repli que les autres phases : un onglet en
                        // arrière-plan ne doit pas figer la cartographie.
                        await nextFrame();
                    }
                }
            }
        }

        /* --------------------------- FLORE ------------------------------ */
        function makeKelpGeometry(variant) {
            const parts = [];
            const tall = variant === 'tall';
            const stalkCount = tall ? 3 : 4;
            for (let s = 0; s < stalkCount; s++) {
                const h = tall ? 15 + Math.random() * 12 : 7 + Math.random() * 9;
                const x = (Math.random() - 0.5) * 3.4;
                const z = (Math.random() - 0.5) * 3.4;
                const lean = (Math.random() - 0.5) * 0.26;
                // Tige en trois segments : la courbe évite le « poteau ».
                for (let seg = 0; seg < 3; seg++) {
                    const sh = h / 3;
                    const t = (seg + 0.5) / 3;
                    const stalk = new THREE.CylinderGeometry(0.055 + 0.02 * (1 - t), 0.19 - 0.04 * t, sh, 5);
                    addPart(parts, stalk, seg % 2 ? '#0b5f52' : '#0f766e',
                        x + lean * h * t * 0.55, sh * (seg + 0.5), z,
                        lean * 0.28, 0, lean * 0.22);
                    gradientize(stalk, '#063f3a', '#1f9d72', 0.04);
                }
                // Frondes : cinq lames incurvées, plus une longue ruban.
                for (let b = 0; b < (tall ? 7 : 5); b++) {
                    const ang = Math.random() * Math.PI * 2;
                    const bh = h * (0.26 + b * 0.135) + Math.random() * 1.2;
                    const bw = 0.62 + Math.random() * 0.72;
                    const blade = makeBladeGeometry(bw, 2.4 + Math.random() * 3.1, 0.45 + Math.random() * 0.75);
                    const tilt = (Math.random() - 0.5) * 0.75;
                    addPart(parts, blade, b % 2 ? '#1f9d72' : '#34d399',
                        x + Math.cos(ang) * 0.35, bh, z + Math.sin(ang) * 0.35,
                        0.10, ang, tilt);
                    gradientize(blade, '#075e54', b % 2 ? '#1fae7f' : '#34d399', 0.07);
                }
                const ribbon = makeBladeGeometry(1.25, h * 0.72, 1.7);
                addPart(parts, ribbon, '#10b981', x, h * 0.16, z, 0.05, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.55);
                gradientize(ribbon, '#064e46', '#10b981', 0.07);
                // Flotteurs translucides : points clairs qui accrochent la lumière.
                addPart(parts, new THREE.SphereGeometry(0.20 + Math.random() * 0.12, 6, 5), '#baf7dd',
                    x + lean * h * 0.5 + (Math.random() - 0.5) * 1.1, h + 0.4 + Math.random() * 1.2, z + (Math.random() - 0.5) * 1.1);
            }
            return mergeGeometries(parts);
        }

        function makeCrystalGeometry() {
            const parts = [];
            const shardColors = ['#38bdf8', '#22d3ee', '#0891b2', '#67e8f9'];
            // Une géode : prismes hexagonaux à pointe, pas des cônes de neige.
            for (let i = 0; i < 7; i++) {
                const h = 4 + Math.random() * 12;
                const x = (Math.random() - 0.5) * 4.2;
                const z = (Math.random() - 0.5) * 4.2;
                const radius = 0.34 + Math.random() * 0.62;
                const bodyH = h * 0.70;
                const tipH = h * 0.30;
                const ry = Math.random() * 3;
                const body = new THREE.CylinderGeometry(radius * 0.74, radius, bodyH, 6);
                addPart(parts, body, shardColors[i % shardColors.length], x, bodyH / 2, z, 0, ry, 0);
                gradientize(body, '#062a3f', i % 3 === 0 ? '#67e8f9' : '#0891b2', 0.06);
                const tip = new THREE.ConeGeometry(radius * 0.74, tipH, 6);
                addPart(parts, tip, shardColors[i % shardColors.length], x, bodyH + tipH / 2, z, 0, ry, 0);
                gradientize(tip, '#0891b2', i % 3 === 0 ? '#cffafe' : '#67e8f9', 0.05);
                if (i < 4) {
                    addPart(parts, new THREE.OctahedronGeometry(0.3 + Math.random() * 0.3, 0), '#e0f2fe',
                        x + (Math.random() - 0.5) * 1.6, 0.3 + Math.random() * 0.5, z + (Math.random() - 0.5) * 1.6,
                        Math.random(), Math.random() * 3, Math.random());
                }
            }
            for (let i = 0; i < 3; i++) {
                const base = new THREE.DodecahedronGeometry(0.7 + Math.random() * 0.9, 0);
                addPart(parts, base, '#164e63', (Math.random() - 0.5) * 5, 0.2, (Math.random() - 0.5) * 5,
                    Math.random(), Math.random() * 3, Math.random());
                gradientize(base, '#082f49', '#155e75', 0.08);
            }
            return mergeGeometries(parts);
        }

        function makeBasaltGeometry() {
            const parts = [];
            for (let i = 0; i < 4; i++) {
                const h = 3 + Math.random() * 9;
                const x = (Math.random() - 0.5) * 3.6;
                const z = (Math.random() - 0.5) * 3.6;
                for (let seg = 0; seg < 3; seg++) {
                    const sh = h / 3;
                    const t = (seg + 0.5) / 3;
                    const column = new THREE.CylinderGeometry(0.38 + 0.16 * (1 - t), 0.78 - 0.12 * t, sh, 6);
                    addPart(parts, column, i % 2 ? '#3f2019' : '#26120e',
                        x + (Math.random() - 0.5) * 0.45, sh * (seg + 0.5), z + (Math.random() - 0.5) * 0.45,
                        (Math.random() - 0.5) * 0.16, Math.random() * 3, (Math.random() - 0.5) * 0.16);
                    gradientize(column, '#160b08', i % 2 ? '#4a2618' : '#2d1710', 0.08);
                }
                // Fissure de lave : une arête lumineuse, pas une boule orange.
                addPart(parts, new THREE.BoxGeometry(0.055, h * 0.58, 0.16), '#fb923c',
                    x + 0.62, h * 0.46, z + 0.2, 0.1, Math.random() * 3, 0.1);
            }
            addPart(parts, new THREE.SphereGeometry(0.34, 6, 5), '#facc15', 0.45, 1.1, -0.35);
            addPart(parts, new THREE.SphereGeometry(0.22, 5, 4), '#fde047', -0.7, 0.6, 0.55);
            return mergeGeometries(parts);
        }

        function makeBoneGeometry() {
            const parts = [];
            // Colonne vertébrale couchée : les vertèbres donnent l'échelle.
            const spine = new THREE.CylinderGeometry(0.22, 0.30, 16, 6);
            addPart(parts, spine, '#cbd5e1', 0, 2.1, 0, Math.PI / 2, 0, 0);
            gradientize(spine, '#64748b', '#f1f5f9', 0.06);
            for (let i = 0; i < 6; i++) {
                const rib = new THREE.TorusGeometry(2.55 - i * 0.18, 0.18, 5, 12, Math.PI);
                addPart(parts, rib, i % 2 ? '#e2e8f0' : '#cbd5e1', 0, 2.4, -6.5 + i * 2.8, 0, Math.PI / 2, 0);
                gradientize(rib, '#64748b', '#f8fafc', 0.05);
            }
            for (let i = 0; i < 5; i++) {
                addPart(parts, new THREE.SphereGeometry(0.34 - i * 0.03, 5, 4), '#e2e8f0',
                    0, 2.15, 7.5 + i * 0.75);
            }
            const skull = new THREE.DodecahedronGeometry(1.5, 0);
            addPart(parts, skull, '#e2e8f0', 0, 3.0, 11.5, 0.15, Math.random(), 0.08);
            gradientize(skull, '#94a3b8', '#f8fafc', 0.06);
            // Nodules xéno accrochés à l'ossature.
            addPart(parts, new THREE.IcosahedronGeometry(0.34, 0), '#c084fc', -1.3, 1.1, -3.2);
            addPart(parts, new THREE.IcosahedronGeometry(0.26, 0), '#e879f9', 1.4, 0.8, 4.4);
            return mergeGeometries(parts);
        }

        function makeXenoGeometry() {
            const parts = [];
            const body = new THREE.IcosahedronGeometry(1.05, 0);
            addPart(parts, body, '#a855f7', 0, 2.0, 0, 0.2, Math.random() * 3, 0.1);
            gradientize(body, '#3b0764', '#e879f9', 0.08);
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2;
                const pod = new THREE.IcosahedronGeometry(0.38 + Math.random() * 0.35, 0);
                addPart(parts, pod, i % 2 ? '#e879f9' : '#c084fc',
                    Math.cos(a) * 1.55, 1.3 + Math.random() * 1.8, Math.sin(a) * 1.55,
                    Math.random(), Math.random() * 3, Math.random());
                gradientize(pod, '#581c87', '#f0abfc', 0.1);
                // Tentacule lumineux qui relie la poche au corps.
                addPart(parts, new THREE.CylinderGeometry(0.035, 0.075, 2.2, 4),
                    '#f0abfc', Math.cos(a) * 0.8, 1.2, Math.sin(a) * 0.8,
                    (Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3);
            }
            addPart(parts, new THREE.TorusGeometry(1.75, 0.06, 4, 18), '#f5d0fe', 0, 1.8, 0, Math.PI / 2, 0, 0);
            addPart(parts, new THREE.OctahedronGeometry(0.5, 0), '#fef3c7', 0, 2.0, 0);
            return mergeGeometries(parts);
        }

        function makeCoralGeometry() {
            const parts = [];
            for (let i = 0; i < 3; i++) {
                const h = 2.4 + Math.random() * 3.2;
                const x = (i - 1) * 0.8;
                const z = (Math.random() - 0.5) * 1.2;
                const trunk = new THREE.CylinderGeometry(0.08, 0.24, h, 5);
                addPart(parts, trunk, i % 2 ? '#fb923c' : '#f97316', x, h / 2, z, 0.08, 0, (Math.random() - 0.5) * 0.18);
                gradientize(trunk, '#7c2d12', i % 2 ? '#fdba74' : '#fbbf24', 0.07);
                for (let b = 0; b < 3; b++) {
                    const a = (b / 3) * Math.PI * 2 + i;
                    const bh = h * (0.5 + b * 0.12);
                    const branch = new THREE.CylinderGeometry(0.04, 0.10, 1.5 + Math.random(), 4);
                    addPart(parts, branch, '#fb923c', x + Math.cos(a) * 0.38, bh, z + Math.sin(a) * 0.38,
                        Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7);
                    gradientize(branch, '#9a3412', '#fed7aa', 0.06);
                    addPart(parts, new THREE.SphereGeometry(0.16 + Math.random() * 0.12, 5, 4), '#fef3c7',
                        x + Math.cos(a) * 0.72, bh + 0.75, z + Math.sin(a) * 0.72);
                }
            }
            return mergeGeometries(parts);
        }

        function makeFanGeometry() {
            const parts = [];
            for (let i = 0; i < 7; i++) {
                const h = 2.2 + Math.random() * 3.4;
                const w = 0.55 + Math.random() * 0.55;
                const geo = new THREE.PlaneGeometry(w, h, 1, 4);
                geo.translate(0, h / 2, 0);
                const pos = geo.attributes.position;
                const bend = (Math.random() - 0.5) * 1.2;
                for (let v = 0; v < pos.count; v++) {
                    const t = U.clamp(pos.getY(v) / h, 0, 1);
                    pos.setZ(v, Math.sin(t * Math.PI * 0.8) * bend * t);
                    pos.setX(v, pos.getX(v) * (1 - t * 0.35));
                }
                const a = (i / 7) * Math.PI * 2;
                addPart(parts, geo, i % 2 ? '#2dd4bf' : '#f59e0b',
                    Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22,
                    (Math.random() - 0.5) * 0.18, a, 0.18 + Math.random() * 0.45);
                gradientize(geo, '#0f3d3a', i % 2 ? '#5eead4' : '#fbbf24', 0.08);
            }
            addPart(parts, new THREE.SphereGeometry(0.28, 6, 5), '#fef3c7', 0, 0.2, 0);
            return mergeGeometries(parts);
        }

        function makeAnemoneGeometry() {
            const parts = [];
            const base = new THREE.SphereGeometry(0.7, 8, 6);
            base.scale(1, 0.62, 1);
            addPart(parts, base, '#7c3aed', 0, 0.45, 0);
            gradientize(base, '#3b0764', '#c084fc', 0.08);
            for (let i = 0; i < 12; i++) {
                const a = (i / 12) * Math.PI * 2 + Math.random() * 0.2;
                const h = 1.1 + Math.random() * 1.5;
                const tentacle = new THREE.CylinderGeometry(0.035, 0.09, h, 4);
                addPart(parts, tentacle, i % 3 ? '#e879f9' : '#67e8f9',
                    Math.cos(a) * 0.48, 0.62 + h / 2, Math.sin(a) * 0.48,
                    Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32);
                gradientize(tentacle, '#581c87', i % 3 ? '#f0abfc' : '#a5f3fc', 0.1);
                addPart(parts, new THREE.SphereGeometry(0.09, 5, 4), '#fef9c3',
                    Math.cos(a) * 0.75, 0.62 + h, Math.sin(a) * 0.75);
            }
            return mergeGeometries(parts);
        }

        /* Tapis de petites lames : la couche basse qui donne au fond sa
           densité sans ajouter des millions de triangles. */
        function makeUnderstoryGeometry(base, tip) {
            const parts = [];
            for (let i = 0; i < 14; i++) {
                const h = 0.55 + Math.random() * 1.9;
                const w = 0.10 + Math.random() * 0.18;
                const geo = new THREE.PlaneGeometry(w, h, 1, 2);
                geo.translate(0, h / 2, 0);
                const pos = geo.attributes.position;
                const bend = (Math.random() - 0.5) * 0.7;
                for (let v = 0; v < pos.count; v++) {
                    const t = U.clamp(pos.getY(v) / h, 0, 1);
                    pos.setZ(v, Math.sin(t * Math.PI) * bend * 0.5);
                    pos.setX(v, pos.getX(v) * (1 - 0.5 * t));
                }
                const ang = Math.random() * Math.PI * 2;
                const rad = Math.sqrt(Math.random()) * 1.15;
                addPart(parts, geo, i % 3 === 0 ? tip : base,
                    Math.cos(ang) * rad, 0, Math.sin(ang) * rad,
                    (Math.random() - 0.5) * 0.25, ang, (Math.random() - 0.5) * 0.22);
                gradientize(geo, base, tip, 0.08);
                if (i % 4 === 0) {
                    addPart(parts, new THREE.TetrahedronGeometry(0.055 + Math.random() * 0.05, 0), tip,
                        Math.cos(ang) * rad, h + 0.06, Math.sin(ang) * rad);
                }
            }
            return mergeGeometries(parts);
        }

        function buildFlora(onProgress) {
            const types = [
                { id: 'kelp', geo: makeKelpGeometry(), color: '#34d399', emissive: '#065f46', rough: 0.72, metal: 0.03, glow: 0.18, regions: ['kelp'] },
                { id: 'kelpTall', geo: makeKelpGeometry('tall'), color: '#0ea47a', emissive: '#064e46', rough: 0.76, metal: 0.03, glow: 0.16, regions: ['kelp', 'metropolis'], density: 0.34, size: 1.2 },
                { id: 'crystal', geo: makeCrystalGeometry(), color: '#67e8f9', emissive: '#0891b2', rough: 0.30, metal: 0.06, glow: 0.72, regions: ['crystal', 'frozen'] },
                { id: 'basalt', geo: makeBasaltGeometry(), color: '#f97316', emissive: '#9a3412', rough: 0.9, metal: 0.12, glow: 0.42, regions: ['volcanic', 'hydro', 'labyrinth'] },
                { id: 'bone', geo: makeBoneGeometry(), color: '#e2e8f0', emissive: '#312e81', rough: 0.55, metal: 0.04, glow: 0.12, regions: ['graveyard', 'frozen'] },
                { id: 'xeno', geo: makeXenoGeometry(), color: '#e879f9', emissive: '#7e22ce', rough: 0.32, metal: 0.2, glow: 1.15, regions: ['midnight', 'maw', 'labyrinth'] },
                { id: 'coral', geo: makeCoralGeometry(), color: '#fb923c', emissive: '#7c2d12', rough: 0.72, metal: 0.04, glow: 0.22, regions: ['metropolis', 'kelp', 'hydro'], size: 1.1 },
                { id: 'fan', geo: makeFanGeometry(), color: '#5eead4', emissive: '#0f766e', rough: 0.6, metal: 0.04, glow: 0.5, regions: ['kelp', 'crystal', 'hydro', 'metropolis', 'graveyard'], density: 0.28, size: 1.45 },
                { id: 'anemone', geo: makeAnemoneGeometry(), color: '#c084fc', emissive: '#581c87', rough: 0.5, metal: 0.06, glow: 0.45, regions: ['kelp', 'crystal', 'frozen', 'midnight', 'maw'], density: 0.16, size: 1.0 },
                { id: 'turf', geo: makeUnderstoryGeometry('#0a5c4b', '#4ade80'), color: '#22c55e', emissive: '#064e3b', rough: 0.8, metal: 0.02, glow: 0.16, regions: ['kelp', 'metropolis', 'hydro', 'crystal'], density: 6.0, size: 1.32 },
                { id: 'turfEmber', geo: makeUnderstoryGeometry('#4c1d12', '#fb923c'), color: '#f97316', emissive: '#7c2d12', rough: 0.9, metal: 0.03, glow: 0.22, regions: ['volcanic', 'hydro'], density: 5.2, size: 1.22 },
                { id: 'turfIce', geo: makeUnderstoryGeometry('#164e63', '#a5f3fc'), color: '#67e8f9', emissive: '#0e7490', rough: 0.5, metal: 0.05, glow: 0.26, regions: ['frozen', 'crystal', 'graveyard'], density: 4.8, size: 1.28 },
                { id: 'turfViolet', geo: makeUnderstoryGeometry('#2e1065', '#c084fc'), color: '#a855f7', emissive: '#4c1d95', rough: 0.6, metal: 0.03, glow: 0.30, regions: ['graveyard', 'labyrinth', 'midnight', 'maw'], density: 5.4, size: 1.32 }
            ];
            const counts = types.map(() => 0);
            const placements = types.map(() => []);
            const rng = U.rng(W.SEED ^ 0x51a7);

            D.REGIONS.forEach(reg => {
                if (reg.id === 'rift') return;
                types.forEach((type, ti) => {
                    if (!type.regions.includes(reg.id)) return;
                    const base = reg.id === 'kelp' ? 1520 : reg.id === 'graveyard' ? 760 : 640;
                    const count = Math.floor(base * (0.55 + q.flora * 0.55) * (type.density || 1));
                    // Des bosquets plutôt qu'un semis uniforme : c'est ce qui
                    // distingue une forêt vivante d'une pelouse de props.
                    const clusterCount = Math.max(5, Math.round(reg.radius / 78));
                    const clusters = [];
                    for (let c = 0; c < clusterCount; c++) {
                        const ca = rng() * Math.PI * 2;
                        const cr = Math.sqrt(rng()) * reg.radius * 0.88;
                        clusters.push({
                            x: reg.center[0] + Math.cos(ca) * cr,
                            z: reg.center[1] + Math.sin(ca) * cr,
                            r: 12 + rng() * Math.max(22, reg.radius * 0.18)
                        });
                    }
                    for (let i = 0; i < count; i++) {
                        let x, z;
                        if (rng() < 0.66) {
                            const cl = clusters[Math.floor(rng() * clusters.length)];
                            const a = rng() * Math.PI * 2;
                            const r = Math.sqrt(rng()) * cl.r;
                            x = cl.x + Math.cos(a) * r;
                            z = cl.z + Math.sin(a) * r;
                        } else {
                            const a = rng() * Math.PI * 2;
                            const r = Math.sqrt(rng()) * reg.radius * 0.84;
                            x = reg.center[0] + Math.cos(a) * r;
                            z = reg.center[1] + Math.sin(a) * r;
                        }
                        if (Math.abs(x) > W.HALF - 40 || Math.abs(z) > W.HALF - 40) continue;
                        if (Math.hypot(x, z) < 24) continue;
                        if (slopeAt(x, z) > 0.85) continue;
                        const y = height(x, z);
                        // Les « héros » ne poussent plus collés à la capsule :
                        // une fronde de 30 m au ras de la vitre bouchait la vue.
                        const distHub = Math.hypot(x, z);
                        const hero = rng() < 0.035 && distHub > 110;
                        const sizeBoost = type.size || 1;
                        const scale = (hero ? 1.45 + rng() * 0.65 : 0.78 + rng() * 0.9) * sizeBoost;
                        placements[ti].push({
                            x, y, z,
                            sx: scale * (0.88 + rng() * 0.22),
                            sy: scale * (0.84 + rng() * 0.44),
                            sz: scale * (0.88 + rng() * 0.22),
                            rot: rng() * Math.PI * 2,
                            tint: rng(),
                            accent: reg.accent
                        });
                        counts[ti]++;
                    }
                });
            });

            types.forEach((type, ti) => {
                if (!counts[ti]) return;
                const mat = new THREE.MeshStandardMaterial({
                    vertexColors: true, roughness: type.rough, metalness: type.metal,
                    side: type.id === 'kelp' ? THREE.DoubleSide : THREE.FrontSide,
                    emissive: new THREE.Color(type.emissive), emissiveIntensity: type.glow,
                    flatShading: type.id === 'crystal' || type.id === 'basalt'
                });
                const mesh = new THREE.InstancedMesh(type.geo, mat, counts[ti]);
                mesh.frustumCulled = false;
                const m = new THREE.Matrix4();
                const quat = new THREE.Quaternion();
                const col = new THREE.Color();
                placements[ti].forEach((p, i) => {
                    quat.setFromEuler(new THREE.Euler(0, p.rot, 0));
                    m.compose(new THREE.Vector3(p.x, p.y, p.z), quat, new THREE.Vector3(p.sx, p.sy, p.sz));
                    mesh.setMatrixAt(i, m);
                    // Les couleurs de vertex portent déjà le dégradé ; l'instance
                    // ne fait varier que la luminosité pour éviter les clones.
                    const shade = 0.72 + p.tint * 0.30;
                    col.setRGB(shade, shade * (0.98 + p.tint * 0.04), shade);
                    col.lerp(new THREE.Color(p.accent || '#ffffff'), 0.04 + p.tint * 0.06);
                    if (mesh.setColorAt)                mesh.setColorAt(i, col);
                });
                if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
                scene.add(mesh);
                api.floraMeshes.push(mesh);
            });
            if (onProgress) onProgress(0.72, 'Croissance de la biosphère');
        }

        /* ---------------------- RELIEF DU FOND MARIN -------------------- */
        /* Blocs, galets et aiguilles instanciés : le fond cesse d'être une
           nappe lisse et donne des repères de profondeur au joueur. */
        function buildSeabedDetails() {
            const rng = U.rng(W.SEED ^ 0x8d31f2);
            const rocks = [];
            const spires = [];

            function sample(reg, minR, maxR) {
                const ang = rng() * Math.PI * 2;
                const rad = (minR + Math.sqrt(rng()) * (maxR - minR)) * reg.radius;
                return {
                    x: reg.center[0] + Math.cos(ang) * rad,
                    z: reg.center[1] + Math.sin(ang) * rad
                };
            }

            D.REGIONS.forEach(reg => {
                if (reg.id === 'rift') return;
                const pal = TERRAIN_PALETTE[reg.id] || TERRAIN_PALETTE.kelp;
                const tint = new THREE.Color(pal.rock);
                const count = Math.floor(520 * (0.55 + q.flora * 0.6));
                for (let i = 0; i < count; i++) {
                    const p = sample(reg, 0.05, 0.98);
                    if (Math.abs(p.x) > W.HALF - 36 || Math.abs(p.z) > W.HALF - 36) continue;
                    if (Math.hypot(p.x, p.z) < 19) continue;
                    if (slopeAt(p.x, p.z) > 1.15) continue;
                    const big = rng();
                    const scale = big > 0.94 ? 3.4 + rng() * 2.8 : 0.5 + Math.pow(rng(), 1.8) * 2.4;
                    const y = height(p.x, p.z) - scale * (0.28 + rng() * 0.3);
                    const tone = tint.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.13);
                    rocks.push({
                        x: p.x, y, z: p.z,
                        sx: scale * (0.72 + rng() * 0.7),
                        sy: scale * (0.55 + rng() * 0.55),
                        sz: scale * (0.72 + rng() * 0.7),
                        ry: rng() * Math.PI * 2, rz: (rng() - 0.5) * 0.35,
                        color: tone, variant: i % 3
                    });
                }
                // Petits galets et éclats : lecture du sol à courte distance.
                for (let i = 0; i < 260; i++) {
                    const p = sample(reg, 0.03, 1.0);
                    if (Math.abs(p.x) > W.HALF - 20 || Math.abs(p.z) > W.HALF - 20) continue;
                    if (Math.hypot(p.x, p.z) < 17) continue;
                    const scale = 0.14 + Math.pow(rng(), 2) * 0.55;
                    rocks.push({
                        x: p.x, y: height(p.x, p.z) - 0.05, z: p.z,
                        sx: scale * (0.9 + rng() * 0.8),
                        sy: scale * 0.45,
                        sz: scale * (0.9 + rng() * 0.8),
                        ry: rng() * Math.PI * 2, rz: 0,
                        color: tint.clone().offsetHSL(0, -0.04, (rng() - 0.5) * 0.18), variant: i % 3
                    });
                }
                // Aiguilles de fond : silhouettes qui bornent l'horizon.
                for (let i = 0; i < 14; i++) {
                    const p = sample(reg, 0.68, 0.99);
                    if (Math.abs(p.x) > W.HALF - 50 || Math.abs(p.z) > W.HALF - 50) continue;
                    const h = 26 + rng() * 78;
                    const w = 7 + rng() * 17;
                    spires.push({
                        x: p.x, y: height(p.x, p.z) + h / 2 - 7, z: p.z,
                        sx: w, sy: h, sz: w * (0.65 + rng() * 0.5),
                        ry: rng() * Math.PI * 2,
                        color: tint.clone().offsetHSL(0, 0, -0.06 + rng() * 0.05)
                    });
                }
            });

            /* Un seul polyèdre déformé : même lecture de roche, 36 triangles
               au lieu de 144, et 4 000 instances restent peu coûteuses. */
            function rockGeometry(seed) {
                const r = U.rng(seed);
                const geo = new THREE.DodecahedronGeometry(1.5, 0);
                const pos = geo.attributes.position;
                for (let i = 0; i < pos.count; i++) {
                    pos.setXYZ(i,
                        pos.getX(i) * (0.8 + r() * 0.45),
                        pos.getY(i) * (0.5 + r() * 0.45),
                        pos.getZ(i) * (0.8 + r() * 0.45));
                }
                geo.computeVertexNormals();
                colorize(geo, '#b9c8cc');
                return geo;
            }
            const geos = [rockGeometry(0x91a), rockGeometry(0x33b), rockGeometry(0x7c4)];
            const mat = new THREE.MeshStandardMaterial({
                vertexColors: true, roughness: 0.95, metalness: 0.04, flatShading: true
            });
            const m = new THREE.Matrix4();
            const qy = new THREE.Quaternion();
            const pos = new THREE.Vector3();
            const scl = new THREE.Vector3();
            const eul = new THREE.Euler();
            geos.forEach((geo, gi) => {
                const list = rocks.filter(r => r.variant === gi);
                if (!list.length) return;
                const mesh = new THREE.InstancedMesh(geo, mat, list.length);
                mesh.frustumCulled = false;
                list.forEach((r, i) => {
                    pos.set(r.x, r.y, r.z);
                    eul.set(r.rz || 0, r.ry, 0);
                    qy.setFromEuler(eul);
                    scl.set(r.sx, r.sy, r.sz);
                    m.compose(pos, qy, scl);
                    mesh.setMatrixAt(i, m);
                    if (mesh.setColorAt) mesh.setColorAt(i, r.color);
                });
                if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
                scene.add(mesh);
                api.floraMeshes.push(mesh);
            });

            if (spires.length) {
                const parts = [];
                addPart(parts, new THREE.ConeGeometry(1, 1, 6), '#8fa2a6', 0, 0, 0, 0, 0, 0, 1, 1, 1);
                addPart(parts, new THREE.ConeGeometry(0.55, 0.7, 5), '#7e9297', 0.52, -0.08, 0.3, 0.12, 0, 0.2);
                const geo = mergeGeometries(parts);
                const sm = new THREE.MeshStandardMaterial({
                    vertexColors: true, roughness: 0.97, metalness: 0.03, flatShading: true
                });
                const mesh = new THREE.InstancedMesh(geo, sm, spires.length);
                mesh.frustumCulled = false;
                spires.forEach((s, i) => {
                    pos.set(s.x, s.y, s.z);
                    eul.set(0, s.ry, 0);
                    qy.setFromEuler(eul);
                    scl.set(s.sx, s.sy, s.sz);
                    m.compose(pos, qy, scl);
                    mesh.setMatrixAt(i, m);
                    if (mesh.setColorAt) mesh.setColorAt(i, s.color);
                });
                if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
                scene.add(mesh);
                api.floraMeshes.push(mesh);
            }
        }

        /* ---------------------------- GISEMENTS -------------------------- */
        const NODE_GEOMETRIES = {};
        function getNodeGeometry(type) {
            if (NODE_GEOMETRIES[type]) return NODE_GEOMETRIES[type];
            const parts = [];
            const palette = D.RESOURCES[type].color;
            const crystal = ['cryoQuartz', 'xenoMatter', 'obsidian', 'uraninite'].includes(type);
            const bio = type === 'biofiber';
            const count = crystal ? 4 : 5;
            for (let i = 0; i < count; i++) {
                const h = crystal ? 1.6 + Math.random() * 2.6 : 0.8 + Math.random() * 1.2;
                const x = (Math.random() - 0.5) * 2.4;
                const z = (Math.random() - 0.5) * 2.4;
                if (crystal) {
                    addPart(parts, new THREE.ConeGeometry(0.34 + Math.random() * 0.4, h * 1.7, 5), palette,
                        x, h * 0.8, z, (Math.random() - 0.5) * 0.4, Math.random() * 3, (Math.random() - 0.5) * 0.4);
                } else if (bio) {
                    const stalk = new THREE.CylinderGeometry(0.08, 0.2, h * 2.2, 5);
                    addPart(parts, stalk, palette, x, h * 1.1, z, (Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4);
                    addPart(parts, new THREE.SphereGeometry(0.3, 6, 5), '#bbf7d0', x, h * 2.2, z);
                } else {
                    addPart(parts, new THREE.DodecahedronGeometry(h, 0), palette,
                        x, h * 0.6, z, Math.random(), Math.random(), Math.random());
                }
            }
            addPart(parts, new THREE.DodecahedronGeometry(0.7, 0), '#1e293b', 0, 0.15, 0);
            const geo = mergeGeometries(parts);
            NODE_GEOMETRIES[type] = geo;
            return geo;
        }

        function buildResourceNodes() {
            const rng = U.rng(W.SEED ^ 0x2f91);
            const distribution = {
                kelp:      { titaniumOre: 8, copperOre: 7, silica: 5, biofiber: 5 },
                crystal:   { cryoQuartz: 8, titaniumOre: 4, silica: 3 },
                frozen:    { cryoQuartz: 6, biofiber: 4, silica: 3, titaniumOre: 3 },
                metropolis:{ titaniumOre: 6, copperOre: 6, silica: 4, biofiber: 3 },
                volcanic:  { magnetite: 8, sulfur: 6, copperOre: 4 },
                hydro:     { sulfur: 6, magnetite: 5, obsidian: 4 },
                graveyard: { xenoMatter: 6, titaniumOre: 4, magnetite: 3 },
                labyrinth: { obsidian: 6, xenoMatter: 5, magnetite: 4, uraninite: 3 },
                midnight:  { xenoMatter: 7, uraninite: 5, obsidian: 4 },
                maw:       { xenoMatter: 6, uraninite: 4, obsidian: 3 }
            };
            const reserving = new Set(D.POIS.map(p => `${Math.round(p.x)},${Math.round(p.z)}`));

            Object.entries(distribution).forEach(([regionId, resMap]) => {
                const reg = D.REGION_BY_ID[regionId];
                Object.entries(resMap).forEach(([type, count]) => {
                    const total = Math.ceil(count * 2.2);
                    for (let i = 0; i < total; i++) {
                        let placed = false;
                        for (let attempt = 0; attempt < 34 && !placed; attempt++) {
                            const ang = rng() * Math.PI * 2;
                            const rad = Math.sqrt(rng()) * reg.radius * 0.78;
                            const x = reg.center[0] + Math.cos(ang) * rad;
                            const z = reg.center[1] + Math.sin(ang) * rad;
                            if (Math.abs(x) > W.HALF - 60 || Math.abs(z) > W.HALF - 60) continue;
                            if (Math.hypot(x, z) < 70) continue;
                            if (slopeAt(x, z) > 0.8) continue;
                            const tooClose = api.nodes.some(n => n.position.distanceTo(new THREE.Vector3(x, height(x, z), z)) < 28);
                            if (tooClose) continue;
                            if ([...reserving].some(k => {
                                const [px, pz] = k.split(',').map(Number);
                                return Math.hypot(px - x, pz - z) < 34;
                            })) continue;
                            const y = height(x, z);
                            const stockBase = type === 'xenoMatter' ? 22 : type === 'uraninite' ? 26 : type === 'cryoQuartz' ? 36 : 46;
                            api.nodes.push({
                                kind: 'node', resourceType: type, regionId,
                                position: new THREE.Vector3(x, y, z),
                                stock: stockBase, maxStock: stockBase,
                                occupied: false, mesh: null, instanceId: -1,
                                scale: 0.85 + rng() * 0.5, rotY: rng() * Math.PI * 2
                            });
                            placed = true;
                        }
                    }
                });
            });

            // Instanciation par type
            const byType = {};
            api.nodes.forEach(node => {
                byType[node.resourceType] = byType[node.resourceType] || [];
                byType[node.resourceType].push(node);
            });
            Object.entries(byType).forEach(([type, list]) => {
                const info = D.RESOURCES[type];
                const geo = getNodeGeometry(type);
                const mat = new THREE.MeshStandardMaterial({
                    vertexColors: true,
                    roughness: 0.32,
                    metalness: type === 'biofiber' ? 0.05 : 0.55,
                    emissive: new THREE.Color(info.color),
                    emissiveIntensity: 0.28
                });
                const mesh = new THREE.InstancedMesh(geo, mat, list.length);
                mesh.frustumCulled = false;
                const ringGeo = new THREE.RingGeometry(2.2, 2.42, 26);
                ringGeo.rotateX(-Math.PI / 2);
                const ringMat = new THREE.MeshBasicMaterial({
                    color: new THREE.Color(info.color), transparent: true, opacity: 0.42,
                    side: THREE.DoubleSide, depthWrite: false
                });
                const ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, list.length);
                ringMesh.frustumCulled = false;
                const m = new THREE.Matrix4();
                const q = new THREE.Quaternion();
                list.forEach((node, index) => {
                    node.instanceId = index;
                    node.mesh = mesh;
                    node.ringMesh = ringMesh;
                    node.ringIndex = index;
                    q.setFromEuler(new THREE.Euler(0, node.rotY, 0));
                    m.compose(node.position, q, new THREE.Vector3(node.scale, node.scale, node.scale));
                    mesh.setMatrixAt(index, m);
                    m.compose(new THREE.Vector3(node.position.x, node.position.y + 0.18, node.position.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
                    ringMesh.setMatrixAt(index, m);
                });
                mesh.userData.nodes = list;
                mesh.userData.isNodeMesh = true;
                ringMesh.userData.nodes = list;
                scene.add(mesh);
                scene.add(ringMesh);
                api.nodeMeshes.push(mesh);
                api.nodeRingMeshes.push(ringMesh);
                list.forEach(node => api.nodeLookup.set(node.position, node));
            });

            // Anneau de sélection réutilisable
            const selGeo = new THREE.RingGeometry(2.5, 2.72, 32);
            selGeo.rotateX(-Math.PI / 2);
            const sel = new THREE.Mesh(selGeo, new THREE.MeshBasicMaterial({
                color: 0xfacc15, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false
            }));
            sel.visible = false;
            scene.add(sel);
            api.selectionRing = sel;
        }

        function hideNodeVisual(node) {
            if (!node || !node.mesh) return;
            const m = new THREE.Matrix4().makeScale(0, 0, 0);
            node.mesh.setMatrixAt(node.instanceId, m);
            node.mesh.instanceMatrix.needsUpdate = true;
            node.ringMesh.setMatrixAt(node.ringIndex, m);
            node.ringMesh.instanceMatrix.needsUpdate = true;
        }

        function consumeNode(node, amount) {
            if (!node || node.stock <= 0) return 0;
            const taken = Math.min(node.stock, Math.max(0, Math.floor(amount)));
            node.stock -= taken;
            if (node.stock <= 0) {
                node.occupied = false;
                hideNodeVisual(node);
            }
            return taken;
        }

        /* ---------------------------- ÉVENTS ----------------------------- */
        function buildVents() {
            const defs = [
                [745, -300], [690, -245], [830, -330], [900, -205],
                [1150, -900], [1230, -960], [1105, -1010], [1290, -850],
                [-1210, -600], [-1310, -660], [-1180, -720],
                [250, -1200], [320, -1340],
                [-150, -1480]
            ];
            const rng = U.rng(W.SEED ^ 0x99ab);
            defs.forEach(([dx, dz], index) => {
                const x = dx * W.SCALE, z = dz * W.SCALE;
                const reg = regionAt(x, z);
                const y = height(x, z);
                const group = new THREE.Group();
                group.position.set(x, y, z);
                // Les champs hydrothermaux ont enfin des silhouettes de
                // cathédrale ; les autres évents restent des cheminées basses.
                const h = reg.id === 'hydro' ? 18 + rng() * 34 : reg.id === 'volcanic' ? 10 + rng() * 20 : 3 + rng() * 4;
                const baseRadius = 1.4 + h * 0.085;
                const chimney = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.55 + h * 0.022, baseRadius, h, 8),
                    new THREE.MeshStandardMaterial({ color: 0x211511, roughness: 0.95, metalness: 0.15 })
                );
                chimney.position.y = h / 2;
                chimney.castShadow = q.shadows;
                group.add(chimney);
                const glow = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.45 + h * 0.025, 0.45 + h * 0.025, 0.5, 10),
                    new THREE.MeshBasicMaterial({ color: 0xf97316 })
                );
                glow.position.y = h + 0.05;
                group.add(glow);
                const halo = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: api.glowTex, color: 0xffa257, transparent: true, opacity: 0.55,
                    blending: THREE.AdditiveBlending, depthWrite: false
                }));
                halo.scale.set(10 + h * 0.35, 10 + h * 0.35, 1);
                halo.position.y = h + 1.5;
                group.add(halo);
                if (index < 3) {
                    const light = new THREE.PointLight(0xff7b32, 1.6, 34, 2);
                    light.position.y = h + 2;
                    group.add(light);
                }
                // Colonne de fumée minérale : 48 à 110 particules par évent,
                // animées sans shader dédié ni nouveau draw call par particule.
                const smokeCount = Math.round((reg.id === 'volcanic' || reg.id === 'hydro' ? 96 : 44) * (0.7 + q.flora * 0.3));
                const sPos = new Float32Array(smokeCount * 3);
                const sData = [];
                for (let i = 0; i < smokeCount; i++) {
                    const ang = rng() * Math.PI * 2;
                    const rad = rng() * 1.5;
                    const data = {
                        x: Math.cos(ang) * rad,
                        z: Math.sin(ang) * rad,
                        y: h + rng() * 2,
                        speed: 0.9 + rng() * 2.4,
                        phase: rng() * Math.PI * 2,
                        spread: 0.4 + rng() * 1.2
                    };
                    sData.push(data);
                    sPos[i * 3] = data.x;
                    sPos[i * 3 + 1] = data.y;
                    sPos[i * 3 + 2] = data.z;
                }
                const smokeGeo = new THREE.BufferGeometry();
                smokeGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
                const smoke = new THREE.Points(smokeGeo, new THREE.PointsMaterial({
                    map: api.glowTex,
                    color: reg.id === 'volcanic' ? 0x8a6a56 : reg.id === 'hydro' ? 0x4d6470 : 0x354a58,
                    size: reg.id === 'volcanic' ? 7 : 5,
                    transparent: true,
                    opacity: reg.id === 'volcanic' ? 0.22 : 0.14,
                    depthWrite: false,
                    sizeAttenuation: true
                }));
                smoke.frustumCulled = false;
                group.add(smoke);
                scene.add(group);
                const vent = {
                    kind: 'vent', position: new THREE.Vector3(x, y, z), mesh: group,
                    occupied: false, height: h, regionId: reg.id, halo,
                    smoke: { points: smoke, data: sData, positions: sPos, top: h, count: smokeCount }
                };
                group.traverse(c => { if (c.isMesh) c.userData.entity = vent; });
                api.vents.push(vent);
            });
        }

        /* ------------------------- MONUMENTS / POI ----------------------- */
        const MAT = {
            metal: new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.28 }),
            darkMetal: new THREE.MeshStandardMaterial({ color: 0x0b1220, metalness: 0.9, roughness: 0.22 }),
            hull: new THREE.MeshStandardMaterial({ color: 0x3b4a57, metalness: 0.65, roughness: 0.5 }),
            rust: new THREE.MeshStandardMaterial({ color: 0xb45309, metalness: 0.35, roughness: 0.75 }),
            rock: new THREE.MeshStandardMaterial({ color: 0x292524, roughness: 0.95, metalness: 0.05 }),
            bone: new THREE.MeshStandardMaterial({ color: 0xd6d3d1, roughness: 0.7, metalness: 0.05 }),
            gold: new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.7, roughness: 0.3 }),
            glass: new THREE.MeshStandardMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.4, metalness: 0.2, roughness: 0.1, side: THREE.DoubleSide })
        };

        function glowMat(hex, opacity = 0.9) {
            return new THREE.MeshBasicMaterial({ color: new THREE.Color(hex), transparent: true, opacity });
        }

        function buildPoi(poi) {
            const y = height(poi.x, poi.z);
            const g = new THREE.Group();
            g.position.set(poi.x, y, poi.z);
            g.rotation.y = U.hash2(Math.round(poi.x), Math.round(poi.z)) * Math.PI * 2;
            const glow = glowMat(poi.accent, 0.85);
            const accent = new THREE.Color(poi.accent);

            const add = (mesh) => { mesh.castShadow = q.shadows; g.add(mesh); return mesh; };
            const box = (w, h, d, mat, x, yy, z, rx = 0, ry = 0, rz = 0) => {
                const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
                m.position.set(x, yy, z); m.rotation.set(rx, ry, rz); return add(m);
            };
            const cyl = (rt, rb, h, mat, x, yy, z, rx = 0, ry = 0, rz = 0, seg = 10) => {
                const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
                m.position.set(x, yy, z); m.rotation.set(rx, ry, rz); return add(m);
            };
            const ring = (rad, tube, mat, x, yy, z, rx = 0, ry = 0, rz = 0) => {
                const m = new THREE.Mesh(new THREE.TorusGeometry(rad, tube, 8, 28), mat);
                m.position.set(x, yy, z); m.rotation.set(rx, ry, rz); return add(m);
            };

            switch (poi.kind) {
                case 'wreck': {
                    const hull = box(24, 8, 10, MAT.hull, 0, 3.4, 0, 0.1, 0, 0.16);
                    box(24.4, 1.4, 10.4, MAT.rust, 0, 3.5, 0, 0.1, 0, 0.16);
                    box(7, 4, 8, MAT.metal, -14, 2.2, 1, 0.1, 0, 0.55);
                    box(3, 10, 3, MAT.metal, 7, 8, 0, 0.2, 0, -0.2);
                    ring(3.4, 0.2, glow, 10, 4.4, 0, 0, 0, 0);
                    api.animated.push({ mesh: hull, kind: 'wreck', phase: Math.random() * 6 });
                    break;
                }
                case 'dome': {
                    cyl(9.4, 10, 2.2, MAT.metal, 0, 1, 0, 0, 0, 0, 16);
                    const dome = new THREE.Mesh(new THREE.SphereGeometry(9, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), MAT.glass);
                    dome.position.y = 2.1; add(dome);
                    for (let i = 0; i < 8; i++) {
                        const rib = new THREE.Mesh(new THREE.TorusGeometry(9.02, 0.11, 5, 24, Math.PI), MAT.metal);
                        rib.position.y = 2.1;
                        rib.rotation.y = (i / 8) * Math.PI;
                        rib.rotation.z = 0;
                        add(rib);
                    }
                    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), glowMat(0x4ade80));
                    core.position.y = 4.5; add(core);
                    api.animated.push({ mesh: core, kind: 'spin', speed: 0.5 });
                    break;
                }
                case 'beacon': {
                    cyl(1.4, 2.4, 4, MAT.rock, 0, 1.8, 0);
                    cyl(0.35, 0.5, 24, MAT.metal, 0, 15, 0);
                    const dish = new THREE.Mesh(new THREE.SphereGeometry(3.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), MAT.metal);
                    dish.position.y = 14; dish.rotation.x = Math.PI; add(dish);
                    const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), glowMat(0x22d3ee));
                    tip.position.y = 27.4; add(tip);
                    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: api.glowTex, color: 0x22d3ee, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
                    sprite.position.y = 28; sprite.scale.set(10, 10, 1); g.add(sprite);
                    api.animated.push({ mesh: tip, kind: 'spin', speed: 1.6 });
                    break;
                }
                case 'crystal': {
                    for (let i = 0; i < 9; i++) {
                        const h = 6 + (i % 4) * 5;
                        const m = new THREE.Mesh(new THREE.ConeGeometry(1 + (i % 3) * 0.55, h, 5), MAT.glass);
                        m.position.set((i - 4) * 2.1, h / 2, Math.sin(i * 1.7) * 4);
                        m.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * 3, (Math.random() - 0.5) * 0.3);
                        add(m);
                    }
                    const core = new THREE.Mesh(new THREE.OctahedronGeometry(2.2, 0), glowMat(0x67e8f9));
                    core.position.y = 5; add(core);
                    api.animated.push({ mesh: core, kind: 'pulse', base: 2.2 });
                    break;
                }
                case 'arch': {
                    const arch = new THREE.Mesh(new THREE.TorusGeometry(16, 1.5, 8, 32, Math.PI), MAT.gold);
                    arch.rotation.z = 0; arch.position.y = 0.2; add(arch);
                    cyl(2.2, 3, 15, MAT.rock, -16, 7.5, 0);
                    cyl(2.2, 3, 15, MAT.rock, 16, 7.5, 0);
                    for (let i = 0; i < 5; i++) {
                        const glyph = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 3.4), glowMat(poi.accent, 0.65));
                        glyph.position.set(-11 + i * 5.5, 9, 0.2);
                        add(glyph);
                    }
                    break;
                }
                case 'statue': {
                    cyl(8, 9.4, 3, MAT.rock, 0, 1.5, 0, 0, 0, 0, 8);
                    cyl(4.6, 5.6, 13, MAT.rock, 0, 9.5, 0, 0, 0, 0, 7);
                    const head = new THREE.Mesh(new THREE.DodecahedronGeometry(3.7, 0), MAT.rock);
                    head.position.y = 19; add(head);
                    box(12, 2.2, 2.4, MAT.rock, 0, 15, 0);
                    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 6), glowMat(0xfbbf24));
                    eye.position.set(0, 19.4, 3.4); add(eye);
                    break;
                }
                case 'caldera': {
                    for (let i = 0; i < 8; i++) {
                        const a = (i / 8) * Math.PI * 2;
                        const h = 5 + (i % 3) * 3;
                        const c = cyl(0.8, 2.2, h, MAT.rock, Math.cos(a) * 10, h / 2, Math.sin(a) * 10);
                        const lava = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.2, 8), glowMat(0xf97316));
                        lava.position.set(Math.cos(a) * 10, h + 0.1, Math.sin(a) * 10); add(lava);
                    }
                    const disc = new THREE.Mesh(new THREE.CircleGeometry(8, 24), glowMat(0xf97316, 0.55));
                    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.3; add(disc);
                    break;
                }
                case 'forge': {
                    const basin = cyl(11, 13, 3, MAT.rock, 0, 1.5, 0, 0, 0, 0, 12);
                    const lava = new THREE.Mesh(new THREE.CircleGeometry(8.6, 24), glowMat(0xfb923c, 0.85));
                    lava.rotation.x = -Math.PI / 2; lava.position.y = 3.05; add(lava);
                    for (let i = 0; i < 6; i++) {
                        const a = (i / 6) * Math.PI * 2;
                        box(2.4, 1, 5, MAT.rock, Math.cos(a) * 11.5, 1.9, Math.sin(a) * 11.5, 0, -a, 0);
                    }
                    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.4, 30, 8, 1, true), glowMat(0xfb923c, 0.15));
                    beam.position.y = 18; add(beam);
                    break;
                }
                case 'fossil': {
                    for (let i = 0; i < 7; i++) {
                        const rib = new THREE.Mesh(new THREE.TorusGeometry(7 - i * 0.35, 0.4, 6, 12, Math.PI), MAT.bone);
                        rib.position.set(0, 0.6, -14 + i * 4.4);
                        rib.rotation.y = Math.PI / 2;
                        add(rib);
                    }
                    const spine = cyl(0.55, 0.7, 32, MAT.bone, 0, 1.4, 0, Math.PI / 2, 0, 0, 6);
                    const skull = new THREE.Mesh(new THREE.DodecahedronGeometry(3.6, 0), MAT.bone);
                    skull.position.set(0, 3.2, 20); skull.scale.set(1, 0.85, 1.25); add(skull);
                    break;
                }
                case 'monolith': {
                    box(5, 26, 5, MAT.darkMetal, 0, 13, 0);
                    const glyph = ring(6, 0.28, glowMat(0xa855f7), 0, 17, 0, Math.PI / 2, 0, 0);
                    ring(4, 0.18, glowMat(0xc084fc, 0.7), 0, 11, 0, Math.PI / 2, 0, 0);
                    const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), glowMat(0xe879f9));
                    core.position.y = 23; add(core);
                    api.animated.push({ mesh: glyph, kind: 'spin', speed: 0.25 });
                    api.animated.push({ mesh: core, kind: 'pulse', base: 1.1 });
                    break;
                }
                case 'gate': {
                    box(4, 34, 8, MAT.darkMetal, -8, 17, 0, 0, 0, -0.06);
                    box(4, 34, 8, MAT.darkMetal, 8, 17, 0, 0, 0, 0.06);
                    box(20, 3, 8, MAT.darkMetal, 0, 33, 0);
                    const veil = new THREE.Mesh(new THREE.PlaneGeometry(16, 32), glowMat(0xa78bfa, 0.16));
                    veil.position.y = 16; add(veil);
                    break;
                }
                case 'wreck2': {
                    box(7, 34, 7, MAT.hull, 0, 17, 0, 0.08, 0, 0.05);
                    box(11, 6, 8, MAT.metal, 0, 28, 0);
                    ring(4.4, 0.28, glowMat(0xe879f9), 0, 8, 0, Math.PI / 2, 0, 0);
                    cyl(1, 1.4, 6, glowMat(0xf0abfc, 0.8), 0, 1, 0);
                    break;
                }
                case 'rift': {
                    const crack = new THREE.Mesh(new THREE.PlaneGeometry(10, 50), glowMat(0xe879f9, 0.28));
                    crack.rotation.x = -Math.PI / 2; crack.position.y = 0.4; add(crack);
                    for (let i = 0; i < 6; i++) {
                        const shard = new THREE.Mesh(new THREE.ConeGeometry(1.2, 12 + i * 2, 4), MAT.darkMetal);
                        shard.position.set((Math.random() - 0.5) * 26, 6, (Math.random() - 0.5) * 26);
                        shard.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * 3, (Math.random() - 0.5) * 0.3);
                        add(shard);
                    }
                    break;
                }
                case 'heart': {
                    const heartGeo = new THREE.IcosahedronGeometry(11, 2);
                    const hp = heartGeo.attributes.position;
                    const hv = new THREE.Vector3();
                    for (let i = 0; i < hp.count; i++) {
                        hv.set(hp.getX(i), hp.getY(i), hp.getZ(i));
                        const n = hv.clone().normalize();
                        const lump = 1 + 0.13 * Math.sin(hv.x * 0.9 + hv.y * 0.7)
                            * Math.sin(hv.z * 1.1 - hv.y * 0.5);
                        hv.copy(n).multiplyScalar(11 * lump);
                        hp.setXYZ(i, hv.x, hv.y, hv.z);
                    }
                    heartGeo.computeVertexNormals();
                    const heartTex = api.heartTex || (api.heartTex = makeHeartTexture());
                    const heart = new THREE.Mesh(heartGeo, new THREE.MeshStandardMaterial({
                        map: heartTex, emissiveMap: heartTex, emissive: 0xffffff,
                        emissiveIntensity: 0.95, roughness: 0.55, metalness: 0.0, flatShading: true
                    }));
                    heart.position.y = 12; heart.scale.y = 1.4; add(heart);
                    // Membrane translucide : donne une épaisseur organique au cœur
                    // au lieu d'une simple boule de texture.
                    const membrane = new THREE.Mesh(
                        new THREE.SphereGeometry(12.1, 20, 14),
                        new THREE.MeshBasicMaterial({
                            color: 0xf0abfc, transparent: true, opacity: 0.075,
                            side: THREE.DoubleSide, depthWrite: false,
                            blending: THREE.AdditiveBlending
                        })
                    );
                    membrane.position.y = 12; membrane.scale.y = 1.4; g.add(membrane);
                    const aura = new THREE.Sprite(new THREE.SpriteMaterial({
                        map: api.glowTex, color: 0xe879f9, transparent: true, opacity: 0.34,
                        blending: THREE.AdditiveBlending, depthWrite: false
                    }));
                    aura.scale.set(92, 92, 1); aura.position.y = 14; g.add(aura);
                    // Nodules bioluminescents répartis sur l'ellipsoïde.
                    const nodules = new THREE.InstancedMesh(
                        new THREE.SphereGeometry(0.55, 6, 4),
                        new THREE.MeshStandardMaterial({ color: 0xf5d0fe, emissive: 0xf0abfc, emissiveIntensity: 1.6 }), 26
                    );
                    const mat4 = new THREE.Matrix4();
                    const qn = new THREE.Quaternion();
                    const vn = new THREE.Vector3();
                    const sn = new THREE.Vector3();
                    for (let i = 0; i < 26; i++) {
                        const th = Math.random() * Math.PI * 2;
                        const ph = Math.acos(2 * Math.random() - 1);
                        const s = 0.45 + Math.random() * 0.9;
                        vn.set(Math.sin(ph) * Math.cos(th) * 11.35, 12 + Math.cos(ph) * 15.6, Math.sin(ph) * Math.sin(th) * 11.35);
                        sn.set(s, s, s);
                        mat4.compose(vn, qn, sn);
                        nodules.setMatrixAt(i, mat4);
                    }
                    add(nodules);
                    for (let i = 0; i < 8; i++) {
                        const a = (i / 8) * Math.PI * 2;
                        cyl(0.45, 1.1, 20 + Math.random() * 12, new THREE.MeshStandardMaterial({ color: 0x3b0764, emissive: 0x86198f, emissiveIntensity: 0.3 }), Math.cos(a) * 10, 6, Math.sin(a) * 10, Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4, 6);
                    }
                    const heartLight = new THREE.PointLight(0xd946ef, 4.2, 110, 2);
                    heartLight.position.set(0, 18, 22); g.add(heartLight);
                    api.animated.push({ mesh: heart, kind: 'pulse', base: 11, aspect: 1.4, strong: true });
                    break;
                }
                case 'hive': {
                    for (let i = 0; i < 9; i++) {
                        const h = 8 + (i % 4) * 6;
                        cyl(0.6 + (i % 2) * 0.4, 1.6, h, new THREE.MeshStandardMaterial({ color: 0x0f5132, emissive: 0x10b981, emissiveIntensity: 0.2 }), (i - 4) * 2.4, h / 2, Math.sin(i) * 3);
                    }
                    const pods = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 8), glowMat(0x34d399, 0.55));
                    pods.position.y = 8; add(pods);
                    api.animated.push({ mesh: pods, kind: 'pulse', base: 4 });
                    break;
                }
                default: {
                    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(5, 0), MAT.rock);
                    rock.position.y = 2.5; add(rock);
                }
            }

            // Marqueur de découverte
            const marker = new THREE.Sprite(new THREE.SpriteMaterial({
                map: api.glowTex, color: accent, transparent: true, opacity: 0.4,
                blending: THREE.AdditiveBlending, depthWrite: false
            }));
            marker.position.y = 34;
            marker.scale.set(12, 12, 1);
            g.add(marker);

            const data = Object.assign({}, poi, {
                kind: 'poi', marker, group: g,
                position: new THREE.Vector3(poi.x, y, poi.z), discovered: false
            });
            g.traverse(c => { if (c.isMesh || c.isSprite) c.userData.entity = data; });
            api.pois.push(data);
            api.landmarks.push(data);
            scene.add(g);
            return data;
        }

        function buildPois() {
            D.POIS.forEach(buildPoi);
        }

        /* --------------------- ÉCLATS DE MÉMOIRE ------------------------- */
        function buildRelics() {
            const shardMat = new THREE.MeshStandardMaterial({
                color: 0xe9d5ff, emissive: 0xa855f7, emissiveIntensity: 1.15,
                metalness: 0.55, roughness: 0.16, transparent: true, opacity: 0.94
            });
            const ringMat = new THREE.MeshBasicMaterial({
                color: 0xd8b4fe, transparent: true, opacity: 0.55,
                side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
            });
            D.RELICS.forEach((def, index) => {
                const y = height(def.x, def.z);
                const group = new THREE.Group();
                group.position.set(def.x, y + 3.6, def.z);
                const shard = new THREE.Mesh(new THREE.OctahedronGeometry(1.15, 0), shardMat);
                shard.scale.set(0.65, 2.2, 0.65);
                shard.castShadow = !!q.shadows;
                group.add(shard);
                const ring = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.07, 5, 36), ringMat);
                ring.rotation.x = Math.PI / 2;
                group.add(ring);
                const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.045, 4, 28), ringMat);
                ring2.rotation.set(Math.PI / 2.6, 0, 0.4);
                group.add(ring2);
                const halo = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: api.glowTex, color: def.accent || 0xd8b4fe, transparent: true, opacity: 0.55,
                    blending: THREE.AdditiveBlending, depthWrite: false
                }));
                halo.scale.set(9, 9, 1);
                group.add(halo);
                const beam = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.32, 0.05, 30, 6, 1, true),
                    new THREE.MeshBasicMaterial({
                        color: 0xc084fc, transparent: true, opacity: 0.10,
                        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
                    })
                );
                beam.position.y = 14;
                group.add(beam);
                const data = Object.assign({}, def, {
                    kind: 'relic', position: new THREE.Vector3(def.x, y, def.z),
                    group, shard, halo, baseY: y + 3.6, collected: false,
                    displayed: false, phase: index * 0.9
                });
                group.traverse(c => { if (c.isMesh || c.isSprite) c.userData.entity = data; });
                api.relics.push(data);
                scene.add(group);
            });
        }

        /* --------------------------- CRÉATURES -------------------------- */
        function makeFishGeometry() {
            const geo = new THREE.ConeGeometry(0.2, 0.85, 5);
            geo.rotateX(Math.PI / 2);
            const parts = [colorize(geo, '#7dd3fc')];
            const tail = new THREE.ConeGeometry(0.22, 0.4, 3);
            tail.rotateX(-Math.PI / 2);
            tail.translate(0, 0, -0.55);
            colorize(tail, '#38bdf8');
            parts.push(tail.index ? tail.toNonIndexed() : tail);
            // fusion simple
            return mergeGeometries(parts);
        }

        function buildCausticPools() {
            const tex = makeGlowTexture();
            const geo = new THREE.PlaneGeometry(1, 1);
            const rng = U.rng(W.SEED ^ 0x7a11c0);
            const group = new THREE.Group();
            D.REGIONS.forEach(reg => {
                if (reg.id === 'rift') return;
                for (let i = 0; i < 5; i++) {
                    const a = rng() * Math.PI * 2;
                    const r = Math.sqrt(rng()) * reg.radius * 0.8;
                    const x = reg.center[0] + Math.cos(a) * r;
                    const z = reg.center[1] + Math.sin(a) * r;
                    const mat = new THREE.MeshBasicMaterial({
                        map: tex, color: new THREE.Color(reg.lightTop).lerp(new THREE.Color(reg.accent), 0.45),
                        transparent: true, opacity: 0.055 + rng() * 0.06,
                        blending: THREE.AdditiveBlending, depthWrite: false
                    });
                    const pool = new THREE.Mesh(geo, mat);
                    pool.rotation.x = -Math.PI / 2;
                    pool.rotation.z = rng() * Math.PI;
                    const size = 38 + rng() * 90;
                    pool.scale.set(size, size * (0.55 + rng() * 0.5), 1);
                    pool.position.set(x, height(x, z) + 0.32, z);
                    group.add(pool);
                }
            });
            group.renderOrder = 3;
            scene.add(group);
            api.causticPools = group;
        }

        function buildSalvage() {
            const hull = new THREE.MeshStandardMaterial({ color: 0x1e3a4a, roughness: 0.45, metalness: 0.7 });
            const trim = new THREE.MeshStandardMaterial({ color: 0x0e7490, roughness: 0.4, metalness: 0.5, emissive: 0x0891b2, emissiveIntensity: 0.4 });
            const names = ['Ravitailleur Aegir-4', 'Cargo Selk-2', 'Navette de relève', 'Module de forage perdu', 'Sonde de reconnaissance', 'Conteneur colonial', 'Épave du Vigilant', 'Atelier orbital tombé', 'Barge de xénobiologie', 'Capsule de secours', 'Fret de la colonie', 'Balise de détresse K-7'];
            const regions = D.REGIONS.filter(r => r.id !== 'rift');
            for (let i = 0; i < 12; i++) {
                const reg = regions[i % regions.length];
                const a = i * 2.39996;
                const x = reg.center[0] + Math.cos(a) * reg.radius * 0.46;
                const z = reg.center[1] + Math.sin(a) * reg.radius * 0.46;
                const y = Math.max(height(x, z) + 4.2, 2.2);
                const group = new THREE.Group();
                const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.4, 3.2), hull);
                body.rotation.z = 0.16; body.rotation.y = a;
                group.add(body);
                const lid = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.28, 3.5), trim);
                lid.position.y = 1.3; lid.rotation.z = 0.16; lid.rotation.y = a;
                group.add(lid);
                const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.09, 5, 28), new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
                ring.rotation.x = Math.PI / 2;
                ring.position.y = 0.4;
                group.add(ring);
                const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshBasicMaterial({ color: 0xfbbf24 }));
                lamp.position.set(1.7, 1.75, 0);
                group.add(lamp);
                const light = new THREE.PointLight(0x67e8f9, 1.4, 24, 2);
                light.position.set(0, 2, 0);
                group.add(light);
                group.position.set(x, y, z);
                scene.add(group);
                api.salvage.push({
                    id: 'cache-' + i, name: names[i], group, position: group.position.clone(),
                    collected: false, revealed: false, ring, light,
                    loot: i % 3 === 0 ? { quantumCore: 1 } : i % 3 === 1 ? { thermicAlloy: 1, bioGel: 1 } : { titaniumIngot: 2, lithiumCell: 1 }
                });
            }
        }

        function buildCurrentRibbons() {
            // Les rubans de courant doivent suivre les régions réellement
            // dilatées, pas les anciens repères du bassin 3 200 m.
            const zones = [
                { id: 'kelp', ratio: 0.64, y: 28, color: 0x34d399 },
                { id: 'crystal', ratio: 0.60, y: 22, color: 0x38bdf8 },
                { id: 'volcanic', ratio: 0.64, y: 16, color: 0xfb7185 }
            ].map(def => {
                const reg = D.REGION_BY_ID[def.id];
                return reg ? {
                    x: reg.center[0], z: reg.center[1], r: reg.radius * def.ratio,
                    y: def.y, color: def.color
                } : null;
            }).filter(Boolean);
            zones.forEach((zone, zi) => {
                const pts = [];
                for (let i = 0; i < 28; i++) {
                    const a = (i / 28) * Math.PI * 2;
                    const rr = zone.r * (0.82 + Math.sin(a * 3 + zi) * 0.08);
                    pts.push(new THREE.Vector3(
                        zone.x + Math.cos(a) * rr,
                        Math.max(height(zone.x + Math.cos(a) * rr, zone.z + Math.sin(a) * rr) + zone.y + Math.sin(a * 2) * 10, 8),
                        zone.z + Math.sin(a) * rr
                    ));
                }
                const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
                const geo = new THREE.TubeGeometry(curve, 96, 0.55, 4, true);
                const mat = new THREE.MeshBasicMaterial({
                    color: zone.color, transparent: true, opacity: 0.085,
                    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
                });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.frustumCulled = false;
                scene.add(mesh);
                const count = 70;
                const positions = new Float32Array(count * 3);
                const phases = [];
                for (let i = 0; i < count; i++) phases.push(Math.random());
                const points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
                    color: zone.color, size: 1.1, transparent: true, opacity: 0.55,
                    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
                }));
                points.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                points.frustumCulled = false;
                scene.add(points);
                api.currentRibbons.push({ curve, points, phases, mesh, zone });
            });
        }

        function buildFauna() {
            // Bancs de lanternelles
            const fishGeo = makeFishGeometry();
            const fishMat = new THREE.MeshStandardMaterial({
                vertexColors: true, emissive: 0x0e7490, emissiveIntensity: 0.8, roughness: 0.4
            });
            const schoolCenters = [
                [-120, 12, 120], [220, 26, -60], [-420, 6, 260], [520, 18, 420],
                [-760, -10, 140], [700, 8, -120], [-680, 20, 820], [480, 0, 780],
                // Vie ambiante autour de la capsule : la colonne d'eau ne doit
                // jamais paraître vide au retour d'expédition.
                [-48, 11, 64], [76, 24, 18], [-96, 7, -34], [34, 30, 138]
            ];
            D.REGIONS.forEach(reg => {
                if (reg.id === 'rift') return;
                const x = reg.center[0] + (Math.random() - 0.5) * reg.radius * 0.55;
                const z = reg.center[1] + (Math.random() - 0.5) * reg.radius * 0.55;
                schoolCenters.push([x, height(x, z) + 15 + Math.random() * 28, z]);
            });
            schoolCenters.forEach((c, si) => {
                const count = 28;
                const mesh = new THREE.InstancedMesh(fishGeo, fishMat, count);
                mesh.frustumCulled = false;
                const fish = [];
                for (let i = 0; i < count; i++) {
                    fish.push({
                        x: c[0] + (Math.random() - 0.5) * 26,
                        y: c[1] + (Math.random() - 0.5) * 8,
                        z: c[2] + (Math.random() - 0.5) * 26,
                        phase: Math.random() * Math.PI * 2,
                        speed: 0.4 + Math.random() * 0.3,
                        scale: 0.7 + Math.random() * 0.7
                    });
                }
                scene.add(mesh);
                api.schools.push({ mesh, fish, center: c, angle: Math.random() * 6, species: 'lanternfish' });
            });

            // Raies-rubans
            const mantaGeo = new THREE.PlaneGeometry(7, 3, 8, 2);
            const mantaMat = new THREE.MeshStandardMaterial({
                color: 0x38bdf8, emissive: 0x0369a1, emissiveIntensity: 0.55,
                side: THREE.DoubleSide, transparent: true, opacity: 0.85, roughness: 0.5
            });
            for (let i = 0; i < 17; i++) {
                const mesh = new THREE.Mesh(mantaGeo, mantaMat);
                const reg = D.REGIONS[(i * 3 + 1) % 10];
                mesh.position.set(reg.center[0] + (Math.random() - 0.5) * 300, height(reg.center[0], reg.center[1]) + 20, reg.center[1] + (Math.random() - 0.5) * 300);
                scene.add(mesh);
                api.mantas.push({
                    mesh, angle: Math.random() * 6, radius: 30 + Math.random() * 70,
                    speed: 0.12 + Math.random() * 0.16, baseY: mesh.position.y,
                    centerX: reg.center[0], centerZ: reg.center[1], species: 'ribbonManta'
                });
            }

            // Méduses de verre
            const jellyMat = new THREE.MeshStandardMaterial({
                vertexColors: true, emissive: 0x0e7490, emissiveIntensity: 0.8,
                transparent: true, opacity: 0.58, roughness: 0.15, metalness: 0.2
            });
            const jellyParts = [];
            addPart(jellyParts, new THREE.SphereGeometry(1.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#a5f3fc', 0, 0, 0);
            for (let t = 0; t < 5; t++) {
                addPart(jellyParts, new THREE.CylinderGeometry(0.03, 0.03, 5, 3), '#67e8f9',
                    (Math.random() - 0.5) * 2, -2.4, (Math.random() - 0.5) * 2);
            }
            const jellyGeo = mergeGeometries(jellyParts);
            for (let i = 0; i < 24; i++) {
                const pool = ['crystal', 'frozen', 'volcanic', 'kelp', 'graveyard', 'labyrinth'];
                const reg = pool[i % pool.length];
                const def = D.REGION_BY_ID[reg];
                const mesh = new THREE.Mesh(jellyGeo, jellyMat);
                const x = def.center[0] + (Math.random() - 0.5) * def.radius;
                const z = def.center[1] + (Math.random() - 0.5) * def.radius;
                mesh.position.set(x, height(x, z) + 8 + Math.random() * 20, z);
                scene.add(mesh);
                api.jellies.push({ mesh, species: 'glassJelly', phase: Math.random() * 6, baseY: mesh.position.y });
            }

            // Prédateurs (chasseurs du vide)
            const hunterMat = new THREE.MeshStandardMaterial({ color: 0x0f0a16, emissive: 0x7e22ce, emissiveIntensity: 0.35, roughness: 0.3, metalness: 0.7 });
            for (let i = 0; i < 4; i++) {
                const group = new THREE.Group();
                const body = new THREE.Mesh(new THREE.ConeGeometry(2.2, 12, 7), hunterMat);
                body.rotation.x = Math.PI / 2;
                group.add(body);
                for (let f = 0; f < 3; f++) {
                    const fin = new THREE.Mesh(new THREE.ConeGeometry(1.2, 5, 3), hunterMat);
                    fin.position.set((f - 1) * 2.4, 0, -2);
                    fin.rotation.z = (f - 1) * 0.65;
                    group.add(fin);
                }
                const eye = new THREE.Mesh(new THREE.SphereGeometry(0.45, 6, 6), glowMat(0xe879f9));
                eye.position.set(0, 0.4, 5.4); group.add(eye);
                const def = D.REGION_BY_ID[['midnight', 'labyrinth', 'maw', 'graveyard'][i]];
                group.position.set(def.center[0] + (Math.random() - 0.5) * 220, height(def.center[0], def.center[1]) + 40, def.center[1] + (Math.random() - 0.5) * 220);
                scene.add(group);
                api.predators.push({
                    mesh: group, species: 'voidHunter', phase: Math.random() * 6,
                    center: def.center, radius: 90 + Math.random() * 90, yBase: group.position.y,
                    speed: 0.08 + Math.random() * 0.06, aggro: 0
                });
            }

            // Mégafaune : deux léviathans qui font vivre l'échelle du monde
            buildMegafauna();

            // Tisserand abyssal
            buildWeaver();
        }

        function buildMegafauna() {
            const hideMat = new THREE.MeshStandardMaterial({
                color: 0x0a1f2e, roughness: 0.48, metalness: 0.32,
                emissive: 0x0e7490, emissiveIntensity: 0.22
            });
            const bellyMat = new THREE.MeshStandardMaterial({
                color: 0x123244, roughness: 0.62, metalness: 0.12,
                emissive: 0x155e75, emissiveIntensity: 0.16, side: THREE.DoubleSide
            });
            const spotMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.85 });
            const finGeo = new THREE.ConeGeometry(1, 1, 4);

            function makeLeviathan(regId, size, tint) {
                const reg = D.REGION_BY_ID[regId];
                const group = new THREE.Group();
                const body = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), hideMat);
                body.scale.set(4.6 * size, 3.1 * size, 13.5 * size);
                group.add(body);
                const head = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), hideMat);
                head.scale.set(3.8 * size, 2.6 * size, 5.6 * size);
                head.position.set(0, 0.2 * size, 10.4 * size);
                group.add(head);
                const jaw = new THREE.Mesh(new THREE.BoxGeometry(5.6 * size, 0.7 * size, 4.4 * size), bellyMat);
                jaw.position.set(0, -1.7 * size, 11.6 * size);
                group.add(jaw);
                const tail = new THREE.Group();
                tail.position.set(0, 0, -12.2 * size);
                const peduncle = new THREE.Mesh(new THREE.ConeGeometry(1.7 * size, 6.5 * size, 8), hideMat);
                peduncle.rotation.x = Math.PI / 2;
                peduncle.position.z = -2.6 * size;
                tail.add(peduncle);
                for (const s of [-1, 1]) {
                    const fluke = new THREE.Mesh(finGeo, bellyMat);
                    fluke.scale.set(2.4 * size, 0.35 * size, 6.2 * size);
                    fluke.position.set(s * 3.1 * size, 0, -6.2 * size);
                    fluke.rotation.set(Math.PI / 2, 0, s * 0.22);
                    tail.add(fluke);
                    const fin = new THREE.Mesh(finGeo, hideMat);
                    fin.scale.set(1.2 * size, 0.28 * size, 5.6 * size);
                    fin.position.set(s * 4.2 * size, -0.6 * size, 4.2 * size);
                    fin.rotation.set(Math.PI / 2, 0, s * 1.05);
                    group.add(fin);
                }
                group.add(tail);
                const dorsal = new THREE.Mesh(finGeo, bellyMat);
                dorsal.scale.set(1.4 * size, 0.4 * size, 3.4 * size);
                dorsal.position.set(0, 3.0 * size, -3.2 * size);
                dorsal.rotation.z = 0.1;
                group.add(dorsal);
                for (const s of [-1, 1]) {
                    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.42 * size, 8, 8), glowMat(tint));
                    eye.position.set(s * 3.1 * size, 0.9 * size, 13.4 * size);
                    group.add(eye);
                }
                for (let i = 0; i < 11; i++) {
                    const spot = new THREE.Mesh(new THREE.SphereGeometry(0.24 * size, 6, 6), spotMat);
                    const a = (i / 11) * Math.PI * 2;
                    spot.position.set(Math.cos(a) * 3.9 * size, Math.sin(a * 0.8) * 1.6 * size, (i - 5.5) * 2.0 * size);
                    group.add(spot);
                }
                const baseY = height(reg.center[0], reg.center[1]) + 64;
                group.position.set(reg.center[0] + reg.radius * 0.5, baseY, reg.center[1]);
                scene.add(group);
                api.megafauna.push({
                    group, tail, name: 'Léviathan', regId, size, tint,
                    center: [reg.center[0], reg.center[1]], radius: reg.radius * (regId === 'kelp' ? 0.30 : 0.52),
                    angle: Math.random() * Math.PI * 2, speed: 0.026 + Math.random() * 0.012,
                    baseY, bob: Math.random() * 6
                });
            }

            makeLeviathan('kelp', 1.0, 0x34d399);
            makeLeviathan('crystal', 0.78, 0x38bdf8);
        }

        function buildWeaver() {
            const group = new THREE.Group();
            const chitin = new THREE.MeshStandardMaterial({ color: 0x08070c, roughness: 0.22, metalness: 0.8 });
            const vein = new THREE.MeshBasicMaterial({ color: 0xc084fc });
            const body = new THREE.Mesh(new THREE.DodecahedronGeometry(4.2, 1), chitin);
            body.scale.set(1.05, 0.72, 2.3);
            group.add(body);
            const head = new THREE.Mesh(new THREE.DodecahedronGeometry(2.4, 0), chitin);
            head.position.set(0, 0.4, 8.4); group.add(head);
            for (let i = 0; i < 6; i++) {
                const eye = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 6), glowMat(0xf59e0b));
                eye.position.set((i % 2 ? 1 : -1) * (0.6 + (i % 3) * 0.5), 0.9 + (i % 2) * 0.3, 10.2 - (i % 3) * 0.5);
                group.add(eye);
            }
            const legs = [];
            for (let i = 0; i < 8; i++) {
                const side = i % 2 === 0 ? 1 : -1;
                const pivot = new THREE.Group();
                pivot.position.set(side * 3.2, -0.5, (Math.floor(i / 2) - 1.5) * 2.9);
                const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.09, 13, 6), chitin);
                limb.position.set(side * 4.6, -3.4, 0);
                limb.rotation.z = side * 0.82;
                pivot.add(limb);
                const glowVein = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.03, 12.6, 4), vein);
                glowVein.position.copy(limb.position);
                glowVein.rotation.copy(limb.rotation);
                pivot.add(glowVein);
                pivot.rotation.y = Math.random() * 0.3 - 0.15;
                group.add(pivot);
                legs.push({ pivot, phase: i * 0.8 });
            }
            for (let i = 0; i < 2; i++) {
                const lure = new THREE.Mesh(new THREE.OctahedronGeometry(0.8, 0), glowMat(0x22d3ee));
                lure.position.set((i ? 1 : -1) * 1.8, -3, 7);
                group.add(lure);
            }
            const light = new THREE.PointLight(0xa855f7, 2.2, 50, 2);
            light.position.set(0, 3, 6); group.add(light);
            group.position.set(280 * W.SCALE, height(280 * W.SCALE, -1240 * W.SCALE) + 14, -1240 * W.SCALE);
            group.traverse(c => { if (c.isMesh) c.userData.entity = { kind: 'weaver', name: 'Tisserand abyssal' }; });
            scene.add(group);

            const silkGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
            const silk = new THREE.Line(silkGeo, new THREE.LineBasicMaterial({ color: 0xe879f9, transparent: true, opacity: 0.9 }));
            silk.visible = false;
            scene.add(silk);

            api.weaver = {
                group, legs, silk, stun: 0, cooldown: 0,
                tethered: false, position: group.position,
                patrolCenter: new THREE.Vector3(240 * W.SCALE, height(240 * W.SCALE, -1250 * W.SCALE) + 18, -1250 * W.SCALE)
            };
            api.silkLine = silk;
        }

        /* ---------------------------- CARTE ----------------------------- */
        function buildMap() {
            const size = 800;
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d');
            const img = ctx.createImageData(size, size);
            const step = W.SIZE / size;
            const hMap = new Float32Array(size * size);
            for (let py = 0; py < size; py++) {
                for (let px = 0; px < size; px++) {
                    const x = -W.HALF + px * step;
                    const z = W.HALF - py * step;
                    hMap[py * size + px] = height(x, z);
                }
            }
            for (let py = 0; py < size; py++) {
                for (let px = 0; px < size; px++) {
                    const x = -W.HALF + px * step;
                    const z = W.HALF - py * step;
                    const h = hMap[py * size + px];
                    const reg = regionAt(x, z);
                    const pal = TERRAIN_PALETTE[reg.id] || TERRAIN_PALETTE.kelp;
                    const depth = depthOf(h);
                    const t = U.clamp(depth / 2600, 0, 1);
                    const base = new THREE.Color(pal.top).lerp(new THREE.Color(pal.deep), t * 0.85);
                    const dx = hMap[py * size + Math.min(size - 1, px + 1)] - h;
                    const dz = hMap[Math.min(size - 1, py + 1) * size + px] - h;
                    const shade = U.clamp(0.7 + (-dx - dz) * 0.22, 0.35, 1.35);
                    const idx = (py * size + px) * 4;
                    img.data[idx] = U.clamp(base.r * 255 * shade, 0, 255);
                    img.data[idx + 1] = U.clamp(base.g * 255 * shade, 0, 255);
                    img.data[idx + 2] = U.clamp(base.b * 255 * shade, 0, 255);
                    img.data[idx + 3] = 255;
                }
            }
            ctx.putImageData(img, 0, 0);
            // Halos des régions
            D.REGIONS.forEach(reg => {
                if (reg.id === 'rift') return;
                const px = ((reg.center[0] + W.HALF) / W.SIZE) * size;
                const py = ((W.HALF - reg.center[1]) / W.SIZE) * size;
                const grad = ctx.createRadialGradient(px, py, 0, px, py, (reg.radius / W.SIZE) * size);
                grad.addColorStop(0, `${reg.accent}22`);
                grad.addColorStop(1, 'transparent');
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, size, size);
            });
            api.mapCanvas = canvas;
        }

        /* --------------------------- MISE À JOUR ------------------------ */
        let cullTimer = 0;
        const tmpMatrix = new THREE.Matrix4();
        const tmpQuat = new THREE.Quaternion();
        const tmpVec = new THREE.Vector3();
        const tmpScale = new THREE.Vector3();

        api.update = function (dt, camera, elapsed) {
            api.time = elapsed;
            if (api.sky) {
                // Dôme solidaire de la caméra : les bords du monde ne peuvent
                // jamais se voir, et la brume garde une profondeur verticale.
                api.sky.position.copy(camera.position);
                const reg = regionAt(camera.position.x, camera.position.z);
                const depth = U.clamp((W.WATER_Y - camera.position.y) / 255, 0, 1);
                const accent = api.skyMat.uniforms.uAccent.value;
                accent.set(reg.accent).multiplyScalar(0.32 + depth * 0.42);
                api.skyMat.uniforms.uTop.value.copy(scene.fog.color).multiplyScalar(0.60 - depth * 0.10);
                api.skyMat.uniforms.uHorizon.value.copy(scene.fog.color)
                    .multiplyScalar(1.01 - depth * 0.04)
                    .lerp(new THREE.Color(reg.accent), 0.05 + depth * 0.05);
                api.skyMat.uniforms.uTime.value = elapsed;
                // Le soleil ne se voit plus passé quelques centaines de mètres.
                api.skyMat.uniforms.uDepth.value = U.clamp(depth * 2.4, 0, 1);
            }
            causticUniform.value = elapsed;
            if (api.water) {
                api.water.material.uniforms.uTime.value = elapsed;
                if (scene.fog) api.water.material.uniforms.uFogColor.value.copy(scene.fog.color);
                // Vue depuis les abysses : la surface lointaine disparaît dans
                // la brume au lieu de dessiner une fausse ligne d'horizon.
                const surfaceDepth = U.clamp((W.WATER_Y - camera.position.y) / 120, 0, 1);
                api.water.material.uniforms.uSurfaceFade.value = 1 - U.smoothstep(0.02, 0.62, surfaceDepth);
            }

            if (api.plankton) {
                api.plankton.position.set(camera.position.x, camera.position.y, camera.position.z);
                api.plankton.rotation.y += dt * 0.012;
                api.plankton.position.y += Math.sin(elapsed * 0.3) * 0.2;
                if (api.planktonMat) api.planktonMat.uniforms.uTime.value = elapsed;
            }
            if (api.snow) {
                api.snow.position.set(camera.position.x, camera.position.y, camera.position.z);
                api.snow.rotation.y -= dt * 0.004;
                if (api.snowMat) api.snowMat.uniforms.uTime.value = elapsed;
            }
            // Les rais restent ancrés à la surface : ils ne doivent jamais
            // traverser la ligne d'eau quand la caméra descend. Ils faiblissent
            // avec la profondeur et respirent lentement, sinon ils dessinent
            // des cônes fixes qui trahissent le décor.
            if (api.rays) {
                api.rays.position.set(camera.position.x, 0, camera.position.z);
                const rayDepth = U.clamp((W.WATER_Y - camera.position.y) * W.DEPTH_SCALE, 0, 2000);
                const rayFade = 1 - U.smoothstep(60, 560, rayDepth);
                api.rays.visible = rayFade > 0.01;
                for (let i = 0; i < api.rays.children.length; i++) {
                    const ray = api.rays.children[i];
                    const base = ray.userData.baseOpacity || 0.1;
                    ray.material.opacity = base * rayFade * (0.72 + 0.28 * Math.sin(elapsed * 0.42 + i * 1.7));
                    ray.rotation.z = (ray.userData.baseRotZ || 0) + Math.sin(elapsed * 0.11 + i) * 0.022;
                }
            }

            // Culling et LOD
            cullTimer -= dt;
            if (cullTimer <= 0) {
                cullTimer = 0.3;
                const view = Math.max(600, api.quality.viewDistance);
                const lodDist = view * 0.55;
                for (let i = 0; i < api.chunks.length; i++) {
                    const ch = api.chunks[i];
                    const d = Math.hypot(ch.cx - camera.position.x, ch.cz - camera.position.z);
                    ch.distance = d;
                    const visible = d < view + CHUNK_SIZE;
                    const high = d < lodDist;
                    if (ch.high.visible !== (visible && high)) ch.high.visible = visible && high;
                    if (ch.low.visible !== (visible && !high)) ch.low.visible = visible && !high;
                }
            }

            // Éclats de mémoire : flottement, rotation, pulsation
            for (let i = 0; i < api.relics.length; i++) {
                const r = api.relics[i];
                if (r.collected) continue;
                r.group.position.y = r.baseY + Math.sin(elapsed * 0.9 + r.phase) * 0.7;
                r.shard.rotation.y += dt * 0.55;
                r.shard.rotation.z = Math.sin(elapsed * 0.7 + r.phase) * 0.12;
                const pulse = 0.72 + Math.sin(elapsed * 1.8 + r.phase) * 0.28;
                r.halo.material.opacity = 0.35 + pulse * 0.28;
                r.halo.scale.setScalar(7 + pulse * 3);
                r.halo.scale.z = 1;
            }

            // Animations de monuments
            for (let i = 0; i < api.animated.length; i++) {
                const a = api.animated[i];
                if (!a.mesh) continue;
                if (a.kind === 'spin') a.mesh.rotation.y += dt * (a.speed || 0.4);
                else if (a.kind === 'pulse') {
                    const s = 1 + Math.sin(elapsed * (a.strong ? 1.1 : 1.8) + i) * 0.08;
                    const b = (a.base || 1) * s;
                    a.mesh.scale.set(b, b * (a.aspect || 1), b);
                } else if (a.kind === 'wreck') {
                    a.mesh.rotation.z = 0.16 + Math.sin(elapsed * 0.25 + a.phase) * 0.012;
                }
            }

            // Fumées hydrothermales
            for (let v = 0; v < api.vents.length; v++) {
                const vent = api.vents[v];
                if (!vent.smoke) continue;
                const sm = vent.smoke;
                for (let i = 0; i < sm.count; i++) {
                    const d = sm.data[i];
                    d.y += d.speed * dt;
                    if (d.y > sm.top + 42) {
                        d.y = sm.top - 1 - Math.random() * 2;
                        d.phase = Math.random() * Math.PI * 2;
                    }
                    const spread = d.spread + (d.y - sm.top) * 0.045;
                    const sway = Math.max(0, d.y - sm.top) * 0.035;
                    sm.positions[i * 3] = d.x * spread + Math.sin(elapsed * 0.55 + d.phase) * sway;
                    sm.positions[i * 3 + 1] = d.y;
                    sm.positions[i * 3 + 2] = d.z * spread + Math.cos(elapsed * 0.43 + d.phase) * sway;
                }
                sm.points.geometry.attributes.position.needsUpdate = true;
            }

            // Bancs de poissons
            for (let s = 0; s < api.schools.length; s++) {
                const school = api.schools[s];
                const t = elapsed * 0.12 + s * 1.7;
                const cx = school.center[0] + Math.cos(t) * 32;
                const cz = school.center[2] + Math.sin(t * 0.8) * 28;
                for (let i = 0; i < school.fish.length; i++) {
                    const f = school.fish[i];
                    const ang = t + f.phase;
                    f.x = cx + Math.cos(ang * 1.3 + i) * 4;
                    f.z = cz + Math.sin(ang * 1.1 + i * 0.6) * 4;
                    f.y += Math.sin(elapsed * 1.3 + f.phase) * dt * 0.8;
                    tmpVec.set(f.x, Math.max(height(f.x, f.z) + 2.5, f.y), f.z);
                    tmpQuat.setFromEuler(new THREE.Euler(0, -Math.atan2(Math.cos(ang * 1.3), Math.sin(ang * 1.1)) + Math.PI / 2, 0));
                    tmpScale.setScalar(f.scale);
                    tmpMatrix.compose(tmpVec, tmpQuat, tmpScale);
                    school.mesh.setMatrixAt(i, tmpMatrix);
                }
                school.mesh.instanceMatrix.needsUpdate = true;
            }

            // Raies
            api.mantas.forEach((m, i) => {
                m.angle += dt * m.speed;
                m.mesh.position.x = m.centerX + Math.cos(m.angle) * m.radius;
                m.mesh.position.z = m.centerZ + Math.sin(m.angle) * m.radius;
                m.mesh.position.y = Math.max(height(m.mesh.position.x, m.mesh.position.z) + 8, m.baseY + Math.sin(m.angle * 2.2) * 3);
                m.mesh.rotation.y = -m.angle + Math.PI / 2;
                m.mesh.rotation.z = Math.sin(m.angle * 3) * 0.18;
                m.mesh.rotation.x = Math.sin(elapsed * 2 + i) * 0.12;
            });

            // Méduses
            api.jellies.forEach((j, i) => {
                j.mesh.position.y = j.baseY + Math.sin(elapsed * 0.7 + j.phase) * 2.4;
                j.mesh.rotation.y += dt * 0.2;
                j.mesh.scale.y = 1 + Math.sin(elapsed * 2 + j.phase) * 0.08;
            });

            // Prédateurs
            api.predators.forEach((p, i) => {
                p.phase += dt * p.speed;
                const x = p.center[0] + Math.cos(p.phase) * p.radius;
                const z = p.center[1] + Math.sin(p.phase * 0.8) * p.radius;
                p.mesh.position.set(x, Math.max(height(x, z) + 18, p.yBase + Math.sin(elapsed * 0.5 + i) * 4), z);
                p.mesh.rotation.y = -p.phase + Math.PI / 2;
            });

            // Mégafaune
            api.megafauna.forEach((m, i) => {
                m.angle += dt * m.speed;
                const x = m.center[0] + Math.cos(m.angle) * m.radius;
                const z = m.center[1] + Math.sin(m.angle) * m.radius;
                m.group.position.x = x;
                m.group.position.z = z;
                m.group.position.y = Math.max(height(x, z) + 42, m.baseY + Math.sin(elapsed * 0.35 + m.bob) * 6);
                m.group.rotation.y = -m.angle + Math.PI / 2;
                m.group.rotation.z = Math.sin(elapsed * 0.45 + i) * 0.06;
                m.tail.rotation.y = Math.sin(elapsed * 0.9 + i) * 0.28;
                m.tail.rotation.x = Math.sin(elapsed * 0.7 + i * 2) * 0.1;
            });

            // Tisserand
            if (api.weaver) {
                const wv = api.weaver;
                wv.legs.forEach(l => { l.pivot.rotation.y = Math.sin(elapsed * 3.4 + l.phase) * 0.22; });
                wv.group.position.y += Math.sin(elapsed * 0.8) * 0.012;
            }

            // Courants : les particules remontent la boucle, les rubans pulsent.
            api.currentRibbons.forEach((ribbon, ri) => {
                const attr = ribbon.points.geometry.attributes.position;
                for (let i = 0; i < ribbon.phases.length; i++) {
                    ribbon.phases[i] = (ribbon.phases[i] + dt * (0.012 + ri * 0.003)) % 1;
                    const p = ribbon.curve.getPointAt(ribbon.phases[i]);
                    attr.array[i * 3] = p.x;
                    attr.array[i * 3 + 1] = p.y + Math.sin(elapsed * 0.8 + i) * 0.5;
                    attr.array[i * 3 + 2] = p.z;
                }
                attr.needsUpdate = true;
                ribbon.mesh.material.opacity = 0.07 + Math.sin(elapsed * 0.5 + ri) * 0.025;
            });

            // Épaves de récupération : balise lente et anneau tournant.
            api.salvage.forEach((cache, ci) => {
                if (!cache.group || cache.collected) return;
                cache.ring.rotation.z += dt * 0.55;
                cache.light.intensity = 1.1 + Math.sin(elapsed * 1.8 + ci) * 0.45;
                cache.group.position.y += Math.sin(elapsed * 0.9 + ci) * 0.0015;
            });

            if (api.selectionRing && api.selectionRing.visible) {
                api.selectionRing.rotation.y += dt * 0.8;
            }
        };

        api.setSelection = function (node) {
            if (!api.selectionRing) return;
            if (!node) { api.selectionRing.visible = false; return; }
            api.selectionRing.visible = true;
            api.selectionRing.position.copy(node.position);
            api.selectionRing.position.y += 0.22;
        };

        api.consumeNode = consumeNode;
        api.hideNodeVisual = hideNodeVisual;

        api.collectRelic = function (relic) {
            if (!relic || relic.collected) return false;
            relic.collected = true;
            relic.group.visible = false;
            return true;
        };

        api.applyRelicState = function (collected) {
            const set = collected || {};
            api.relics.forEach(relic => {
                if (set[relic.id]) {
                    relic.collected = true;
                    relic.group.visible = false;
                }
            });
        };

        api.buildAsync = async function (onProgress) {
            const report = (p, label) => { if (onProgress) onProgress(p, label); };
            report(0.04, 'Initialisation de la sonde');
            buildAtmosphere();
            buildWater();
            buildGodRays();
            buildParticles();
            await nextFrame();
            await buildTerrain(report);
            buildRiftWall();
            report(0.64, 'Analyse des gisements');
            buildMap();
            buildVents();
            await nextFrame();
            buildFlora(report);
            buildSeabedDetails();
            report(0.78, 'Forage des filons');
            buildResourceNodes();
            report(0.86, 'Relevé des monuments');
            buildPois();
            buildRelics();
            buildCausticPools();
            buildSalvage();
            buildCurrentRibbons();
            await nextFrame();
            report(0.94, 'Observation de la faune');
            buildFauna();
            report(1.0, 'Monde prêt');
            return api;
        };

        api.nearestPoi = function (pos) {
            let best = null, bestD = Infinity;
            api.pois.forEach(p => {
                const d = p.position.distanceTo(pos);
                if (d < bestD) { bestD = d; best = p; }
            });
            return { poi: best, distance: bestD };
        };

        api.setNodeHighlight = function (on) {
            api.nodeRingMeshes.forEach(mesh => {
                mesh.visible = true;
                mesh.material.opacity = on ? 0.92 : 0.42;
            });
        };

        api.nearestSpecies = function (pos) {
            let best = null, bestD = 48;
            api.schools.forEach(s => {
                const c = new THREE.Vector3(s.center[0], pos.y, s.center[2]);
                const d = Math.abs(pos.x - s.center[0]) + Math.abs(pos.z - s.center[2]);
                if (d < bestD) { bestD = d; best = 'lanternfish'; }
                s.fish.forEach(f => {
                    const dd = Math.hypot(f.x - pos.x, f.y - pos.y, f.z - pos.z);
                    if (dd < bestD) { bestD = dd; best = 'lanternfish'; }
                });
            });
            api.mantas.forEach(m => {
                const d = m.mesh.position.distanceTo(pos);
                if (d < 55 && d < bestD) { bestD = d; best = 'ribbonManta'; }
            });
            api.jellies.forEach(j => {
                const d = j.mesh.position.distanceTo(pos);
                if (d < 40 && d < bestD) { bestD = d; best = 'glassJelly'; }
            });
            api.predators.forEach(p => {
                const d = p.mesh.position.distanceTo(pos);
                if (d < 55 && d < bestD) { bestD = d; best = p.species; }
            });
            api.megafauna.forEach(m => {
                const d = m.group.position.distanceTo(pos);
                if (d < 110 && d < bestD) { bestD = d; best = 'leviathan'; }
            });
            if (api.weaver && api.weaver.group.position.distanceTo(pos) < 90) {
                bestD = Math.min(bestD, api.weaver.group.position.distanceTo(pos));
                best = 'abyssalWeaver';
            }
            return best;
        };

        api.dispose = function () {
            scene.remove(api.water);
            if (api.plankton) scene.remove(api.plankton);
            if (api.snow) scene.remove(api.snow);
        };

        return api;
    }

    return { create, TERRAIN_PALETTE };
})();
