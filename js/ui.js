/* ============================================================================
 * ui.js — Interface holographique, HUD temps réel, carte, recherche,
 * fabrication, journal, codex, paramètres et transitions.
 * ==========================================================================*/
window.PP = window.PP || {};

PP.UI = (function () {
    'use strict';

    const D = PP.Data;
    const U = D.UTILS;
    const $ = id => document.getElementById(id);

    let game = null;
    let state = null;
    let world = null;
    let activeMachine = null;
    let invFilter = 'all';
    let invSelected = null;
    let invSearch = '';
    let batchCraft = false;
    let activeCodexCat = 'region';
    let activeCodexId = null;
    let mapPoiTarget = null;
    let mapView = { zoom: 1.05, cx: 0, cz: 0, dragging: false, moved: 0, lastX: 0, lastY: 0 };
    let settingsReturn = null;
    let notificationCount = 0;
    let compassInner = null;
    let compassTicks = [];
    let lastModalFocus = null;

    const MODALS = ['modal-command', 'modal-map', 'modal-tech', 'modal-inventory', 'modal-machine', 'modal-catalog', 'modal-journal', 'modal-codex', 'modal-settings', 'modal-pause', 'modal-help', 'modal-victory'];
    const RANKS = ['PLONGEUR', 'TECHNICIEN', 'INGÉNIEUR', 'ARCHITECTE', 'PIONNIER', 'HADAL', 'XÉNO-SAGE'];
    const XP_STEPS = [0, 200, 500, 1000, 1700, 2600, 3800, 5200, 7000, 9200, 11800, 14800];

    function guard(fn) { try { fn(); } catch (error) { console.error('[UI]', error); } }

    // Les libellés de contrats et de marqueurs peuvent provenir d'une
    // sauvegarde importée : ils ne doivent jamais être interprétés comme du HTML.
    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch]));
    }

    /* ------------------------------------------------------------------ */
    /* INITIALISATION                                                      */
    /* ------------------------------------------------------------------ */
    function init(gameRef) {
        game = gameRef;
        state = game.state;
        world = game.world;

        // Sémantique de dialogue pour les lecteurs d'écran et le focus clavier.
        MODALS.forEach(id => {
            const modal = $(id);
            if (!modal) return;
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            const title = modal.querySelector('h2');
            if (title) {
                if (!title.id) title.id = `${id}-title`;
                modal.setAttribute('aria-labelledby', title.id);
            }
        });
        const notifications = $('notifications');
        if (notifications) {
            notifications.setAttribute('aria-live', 'polite');
            notifications.setAttribute('aria-atomic', 'false');
        }
        buildCompass();
        buildQuickResources();
        bindGlobalEvents();
        bindMenu();
        bindHUD();
        bindModals();
        bindMap();
        bindSettings();
        syncSettingsInputs();
        updateMenu();
    }

    function buildCompass() {
        const container = $('compass-ticks');
        if (!container) return;
        container.innerHTML = '';
        compassInner = document.createElement('div');
        compassInner.style.cssText = 'position:absolute;left:0;top:0;height:100%;width:1440px;will-change:transform;';
        const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
        compassTicks = [];
        for (let i = 0; i < 72; i++) {
            const tick = document.createElement('i');
            const major = i % 9 === 0;
            if (major) tick.className = 'major';
            tick.style.left = (i * 4) + 'px';
            compassInner.appendChild(tick);
            if (major) {
                const label = document.createElement('b');
                label.textContent = cardinals[i / 9] || '';
                label.style.left = (i * 4) + 'px';
                compassInner.appendChild(label);
            }
            compassTicks.push(tick);
        }
        container.appendChild(compassInner);
    }

    function buildQuickResources() {
        const wrap = $('quick-res');
        if (!wrap) return;
        const keys = ['titaniumIngot', 'lithiumCell', 'magnetCoil', 'glassPane', 'bioGel', 'thermicAlloy', 'xenoMatter', 'xenoCore', 'quantumCore'];
        wrap.innerHTML = keys.map(key => {
            const info = D.RESOURCES[key];
            return `<div class="res-chip" title="${info.name}"><span style="display:flex;gap:4px;align-items:center"><i style="background:${info.color}"></i>${info.short}</span><b data-res="${key}">0</b></div>`;
        }).join('');
    }

    /* ------------------------------------------------------------------ */
    /* BOOT / MENU                                                         */
    /* ------------------------------------------------------------------ */
    function setBoot(progress, label) {
        const bar = $('boot-bar');
        const pct = $('boot-pct');
        if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
        if (pct) pct.textContent = `${Math.round(progress * 100)} %`;
        if (label && $('boot-label')) $('boot-label').textContent = label;
    }

    function hideBoot() {
        const boot = $('boot-screen');
        if (boot) boot.classList.add('done');
    }

    function showMenu(show) {
        $('main-menu').classList.toggle('hidden', !show);
    }

    function updateMenu() {
        if (!state) return;
        const regions = Object.keys(state.visitedRegions || {}).length;
        const pois = Object.keys(state.discoveredPois || {}).length;
        const techs = Object.keys(state.unlockedTechs || {}).length;
        const codex = Object.keys(state.codex || {}).length;
        const depth = Math.round(state.stats.maxDepth || 0);
        if ($('menu-regions')) $('menu-regions').textContent = `${regions} / 10`;
        if ($('menu-pois')) $('menu-pois').textContent = `${pois} / ${D.POIS.length}`;
        if ($('menu-techs')) $('menu-techs').textContent = `${techs} / ${D.TECHS.length}`;
        if ($('menu-relics')) $('menu-relics').textContent = `${Object.keys(state.relics || {}).length} / ${D.RELICS.length}`;
        if ($('menu-depth')) $('menu-depth').textContent = depth > 0 ? `${depth} m` : '—';
        if ($('menu-time')) $('menu-time').textContent = U.formatTime(state.stats.playTime || 0);
        if ($('menu-progress')) $('menu-progress').style.width = `${Math.min(100, Math.round((techs / D.TECHS.length) * 50 + (regions / 10) * 30 + (pois / D.POIS.length) * 15 + (Object.keys(state.relics || {}).length / D.RELICS.length) * 5))}%`;
        const active = getActiveMission();
        if (active && $('menu-objective')) $('menu-objective').textContent = `${active.mission.name} — ${active.mission.objective}`;
        if ($('menu-feedback') && game && game.saveExists && game.saveExists()) {
            $('menu-feedback').textContent = 'Sauvegarde locale détectée sur cet appareil.';
        }
        if ($('codex-hint')) $('codex-hint').textContent = `${codex} ENTRÉES ENREGISTRÉES`;
    }

    function setPlayLabel(label) {
        const btn = $('play-btn');
        if (btn) btn.innerHTML = label;
    }

    /* ------------------------------------------------------------------ */
    /* NOTIFICATIONS                                                       */
    /* ------------------------------------------------------------------ */
    function toast(text, type = 'info', title = null) {
        const wrap = $('notifications');
        if (!wrap) return;
        while (wrap.children.length >= 4) wrap.removeChild(wrap.firstElementChild);
        const glyphs = { info: '◈', success: '✓', warn: '⚠', danger: '✕', xeno: '✦' };
        const titles = { info: 'SONDE', success: 'SYSTÈME', warn: 'ALERTE', danger: 'CRITIQUE', xeno: 'XÉNO' };
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerHTML = `<div class="t-icon">${glyphs[type] || '◈'}</div><div class="t-body"><div class="t-title">${escapeHtml(title || titles[type] || 'SONDE')}</div><div class="t-text"></div></div>`;
        el.querySelector('.t-text').textContent = text;
        wrap.appendChild(el);
        notificationCount++;
        while (wrap.children.length > 4) wrap.removeChild(wrap.firstElementChild);
        setTimeout(() => {
            el.classList.add('out');
            setTimeout(() => el.remove(), 320);
        }, 3800);
    }

    /* ------------------------------------------------------------------ */
    /* HUD                                                                 */
    /* ------------------------------------------------------------------ */
    function setHUDVisible(v) {
        $('hud').classList.toggle('hidden', !v);
        $('crosshair').classList.toggle('hidden', !v);
    }

    function updateHUD() {
        if (!state || !state.isPlaying) return;
        const cam = game.camera;
        const depth = world.depthOf(cam.position.y);
        const region = world.regionAt(cam.position.x, cam.position.z);

        if ($('region-name')) $('region-name').textContent = region.full || region.name;
        const sectorLabel = region.id === 'rift' ? '—' : String(region.index || 1).padStart(2, '0');
        if ($('region-index')) $('region-index').textContent = sectorLabel;
        if ($('region-desc')) $('region-desc').textContent = region.desc;
        if ($('minimap-biome')) $('minimap-biome').textContent = region.id === 'rift' ? 'FAILLE PÉRIPHÉRIQUE' : `SECTEUR ${sectorLabel}`;
        if ($('minimap-coords')) $('minimap-coords').textContent = `${Math.round(cam.position.x)} · ${Math.round(cam.position.z)}`;

        const crush = state.maxCrushDepth;
        const pressure = U.clamp(depth / crush, 0, 1.4);
        if ($('depth-value')) $('depth-value').textContent = depth;
        if ($('depth-crush')) {
            $('depth-crush').textContent = `/ ${crush} m`;
            $('depth-crush').className = 'depth-crush' + (depth > crush ? ' danger' : pressure > 0.8 ? ' warn' : '');
        }
        if ($('pressure-fill')) $('pressure-fill').style.width = `${Math.min(100, pressure * 100)}%`;
        $('pressure-overlay').classList.toggle('show', pressure >= 0.85);

        const dir = new THREE.Vector3();
        cam.getWorldDirection(dir);
        const heading = (Math.atan2(dir.x, -dir.z) * 180 / Math.PI + 360) % 360;
        const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
        if ($('compass-heading')) $('compass-heading').textContent = `${cardinals[Math.round(heading / 45) % 8]} · ${String(Math.round(heading)).padStart(3, '0')}°`;
        if (compassInner) {
            const width = $('compass-ticks').clientWidth || 340;
            compassInner.style.transform = `translateX(${width / 2 - heading * 4}px)`;
        }

        const o2 = Math.max(0, state.o2), maxO2 = state.maxO2;
        const hull = Math.max(0, state.hull);
        if ($('val-o2')) $('val-o2').textContent = Math.ceil(o2);
        if ($('val-hull')) $('val-hull').textContent = Math.ceil(hull);
        if ($('arc-o2')) $('arc-o2').style.strokeDashoffset = 169.6 * (1 - U.clamp(o2 / maxO2, 0, 1));
        if ($('arc-hull')) $('arc-hull').style.strokeDashoffset = 169.6 * (1 - U.clamp(hull / 100, 0, 1));
        $('vital-o2').classList.toggle('warn', o2 / maxO2 < 0.22);
        $('vital-hull').classList.toggle('warn', hull < 30);

        const powerRatio = state.powerProduced > 0 ? U.clamp(state.powerConsumed / state.powerProduced, 0, 1) : 0;
        if ($('arc-power')) $('arc-power').style.strokeDashoffset = 169.6 * (1 - powerRatio);
        if ($('val-power')) $('val-power').textContent = `${state.powerConsumed}`;
        $('vital-power').classList.toggle('warn', state.powerConsumed > state.powerProduced);

        const rank = rankInfo(state.xp || 0);
        if ($('rank-name')) $('rank-name').textContent = rank.name;
        if ($('rank-level')) $('rank-level').textContent = `NIV. ${rank.level}`;
        if ($('xp-fill')) $('xp-fill').style.width = `${rank.pct}%`;
        if ($('xp-value')) $('xp-value').textContent = `${Math.round(state.xp || 0)} / ${rank.next} XP`;
        if ($('session-time')) $('session-time').textContent = `IMMERSION ${U.formatTime(state.stats.playTime || 0)}`;
        if ($('relic-line')) {
            const relics = Object.keys(state.relics || {}).length;
            const contracts = (state.stats.contractsDone || 0);
            $('relic-line').textContent = `✦ MÉMOIRES ${relics} / ${D.RELICS.length} · ${contracts} CONTRAT${contracts > 1 ? 'S' : ''}`;
        }

        if ($('coords-line')) {
            $('coords-line').textContent = `X ${Math.round(cam.position.x)} · Z ${Math.round(cam.position.z)} · BALISE ${state.waypoint ? 'ACTIVE' : '—'}`;
        }

        if ($('credit-chip')) $('credit-chip').textContent = `◈ ${Math.round(state.credits || 0)} CR`;
        if ($('inv-credits')) $('inv-credits').textContent = `◈ ${Math.round(state.credits || 0)} CR`;
        if ($('command-credits')) $('command-credits').textContent = `◈ ${Math.round(state.credits || 0)} CR`;
        const profile = game.difficultyProfile ? game.difficultyProfile() : null;
        if ($('profile-chip') && profile) $('profile-chip').textContent = profile.name.toUpperCase();

        // Navigation : distance, relèvement relatif et estimation de trajet.
        if ($('nav-waypoint')) {
            if (state.waypoint) {
                const dx = state.waypoint.x - cam.position.x;
                const dz = state.waypoint.z - cam.position.z;
                const dist = Math.hypot(dx, dz);
                const targetBearing = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
                const rel = ((targetBearing - heading + 540) % 360) - 180;
                const clock = Math.round(((rel + 360) % 360) / 30) % 12 || 12;
                $('nav-waypoint').textContent = state.waypoint.label || 'BALISE';
                $('nav-distance').textContent = `${Math.round(dist)} M · ${clock}H · ${U.formatTime(dist / Math.max(8, state.moveSpeed || 24))}`;
            } else {
                $('nav-waypoint').textContent = 'AUCUNE';
                $('nav-distance').textContent = '—';
            }
        }
        if ($('nav-current')) {
            const current = state.currentInfo || { speed: 0 };
            let currentLabel = 'CALME';
            if (current.speed > 2.5) currentLabel = 'FORT';
            else if (current.speed > 1.2) currentLabel = 'MODÉRÉ';
            $('nav-current').textContent = `${currentLabel} ${current.speed.toFixed(1)} M/S`;
        }
        if ($('nav-mastery')) {
            const cells = state.regionCells && state.regionCells[region.id] ? Object.keys(state.regionCells[region.id]).length : 0;
            const totalCells = Math.max(24, Math.round((Math.PI * region.radius * region.radius) / (260 * 260)));
            $('nav-mastery').textContent = `${Math.min(100, Math.round((cells / totalCells) * 100))} %`;
        }

        const regions = Object.keys(state.visitedRegions || {}).length;
        if ($('discovery-badge')) $('discovery-badge').textContent = `${regions} / 10 RÉGIONS`;

        // Progression locale du secteur : POI + éclats de mémoire.
        if ($('region-progress-fill')) {
            const rPois = world.pois.filter(p => p.region === region.id);
            const rRelics = D.RELICS.filter(r => r.region === region.id);
            const foundPois = rPois.filter(p => state.discoveredPois[p.id]).length;
            const foundRelics = rRelics.filter(r => state.relics[r.id]).length;
            const total = rPois.length + rRelics.length;
            const done = foundPois + foundRelics;
            const pct = total ? Math.round((done / total) * 100) : 0;
            $('region-progress-fill').style.width = `${pct}%`;
            $('region-progress-label').textContent = `SECTEUR ${pct} %`;
            $('region-progress-count').textContent = `${done} / ${total} REPÈRES`;
        }

        // Alerte de proximité : léviathan et chasseurs du vide.
        const threatEl = $('threat-alert');
        if (threatEl) {
            let threatName = '', threatDist = Infinity;
            if (world.weaver && !world.weaver.stun) {
                const d = world.weaver.group.position.distanceTo(cam.position);
                if (d < threatDist) { threatDist = d; threatName = 'Tisserand abyssal'; }
            }
            (world.predators || []).forEach(p => {
                const d = p.mesh.position.distanceTo(cam.position);
                if (d < threatDist) { threatDist = d; threatName = 'Chasseur du vide'; }
            });
            const show = threatName && threatDist < 220;
            threatEl.classList.toggle('show', show);
            if (show) {
                let bearing = '';
                const threatPos = threatName === 'Tisserand abyssal' && world.weaver ? world.weaver.group.position : null;
                const predator = (world.predators || []).find(p => p.mesh.position.distanceTo(cam.position) <= threatDist + 1);
                const target = threatPos || (predator && predator.mesh.position);
                if (target) {
                    const dirX = target.x - cam.position.x;
                    const dirZ = target.z - cam.position.z;
                    const targetBearing = (Math.atan2(dirX, -dirZ) * 180 / Math.PI + 360) % 360;
                    const rel = ((targetBearing - heading + 540) % 360) - 180;
                    const clock = Math.round(((rel + 360) % 360) / 30) % 12 || 12;
                    bearing = ` · ${clock}H`;
                }
                $('threat-text').textContent = `${threatName.toUpperCase()} À ${Math.round(threatDist)} M${bearing}`;
                threatEl.classList.toggle('imminent', threatDist < 70);
            }
        }

        // Chips d'état des protocoles de terrain.
        if ($('chip-o2-reserve')) {
            $('chip-o2-reserve').textContent = state.emergencyO2Used ? '◌ RÉSERVE O₂ CONSOMMÉE' : '◌ RÉSERVE O₂ PRÊTE [U]';
            $('chip-o2-reserve').className = `field-chip ${state.emergencyO2Used ? 'warn' : 'on'}`;
        }
        if ($('chip-depth-hold')) {
            $('chip-depth-hold').textContent = state.depthHold ? `⇕ PROF. VERROUILLÉE ${Math.round(state.heldDepth)} M [V]` : '⇕ PROFONDEUR LIBRE [V]';
            $('chip-depth-hold').className = `field-chip ${state.depthHold ? 'on' : ''}`;
        }
        if ($('chip-nodes')) {
            $('chip-nodes').textContent = state.nodeHighlight ? '◎ SURBRILLANCE ACTIVE [N]' : '◎ GISEMENTS [N]';
            $('chip-nodes').className = `field-chip ${state.nodeHighlight ? 'on' : ''}`;
        }
        if ($('chip-auto-scan')) {
            $('chip-auto-scan').textContent = state.autoScan ? '◎ BALAYAGE AUTO ACTIF [F10]' : '◎ BALAYAGE AUTO [F10]';
            $('chip-auto-scan').className = `field-chip ${state.autoScan ? 'on' : ''}`;
        }
        if ($('chip-surge')) {
            $('chip-surge').textContent = state.surgeTimer > 0 ? `⚡ SURCHARGE ${Math.ceil(state.surgeTimer)} S` : (state.surgeCooldown > 0 ? `⚡ RECHARGE ${Math.ceil(state.surgeCooldown)} S` : '⚡ SURCHARGE [F6]');
            $('chip-surge').className = `field-chip ${state.surgeTimer > 0 ? 'on' : state.surgeCooldown > 0 ? 'warn' : ''}`;
        }
        if ($('chip-silence')) {
            $('chip-silence').textContent = state.silenceTimer > 0 ? `◌ SILENCE ${Math.ceil(state.silenceTimer)} S` : (state.silenceCooldown > 0 ? `◌ RECHARGE ${Math.ceil(state.silenceCooldown)} S` : '◌ SILENCE [F7]');
            $('chip-silence').className = `field-chip ${state.silenceTimer > 0 ? 'on' : state.silenceCooldown > 0 ? 'warn' : ''}`;
        }
        if ($('noise-badge')) {
            const drills = state.buildings.filter(b => b.type === 'drill').length;
            const stealth = (state.stealthFactor || 1) < 0.75;
            const noise = stealth ? 'FURTIF' : drills > 2 ? 'ÉLEVÉ' : drills > 0 ? 'MODÉRÉ' : 'NOMINAL';
            $('noise-badge').textContent = `BRUIT : ${noise}`;
            $('noise-badge').className = `chip ${noise === 'ÉLEVÉ' ? 'danger' : noise === 'MODÉRÉ' ? 'warn' : stealth ? 'ok' : ''}`;
        }

        // Objectif actif
        const active = getActiveMission();
        if (active) {
            const { mission, track } = active;
            if ($('objective-title')) $('objective-title').textContent = mission.name.toUpperCase();
            if ($('objective-text')) $('objective-text').textContent = mission.objective;
            if ($('objective-chapter')) $('objective-chapter').textContent = mission.chapter;
            if ($('objective-progress')) $('objective-progress').textContent = `${track.cur} / ${track.max}`;
            if ($('objective-fill')) $('objective-fill').style.width = `${Math.min(100, (track.cur / Math.max(1, track.max)) * 100)}%`;
            if ($('objective-mini-text')) $('objective-mini-text').textContent = mission.objective;
            if ($('objective-mini-progress')) $('objective-mini-progress').textContent = `${track.cur} / ${track.max}`;
        } else {
            if ($('objective-mini-text')) $('objective-mini-text').textContent = 'Exploration libre · achevez le protocole orbital';
            if ($('objective-mini-progress')) $('objective-mini-progress').textContent = '—';
        }

        // Ressources rapides
        document.querySelectorAll('[data-res]').forEach(el => {
            const key = el.getAttribute('data-res');
            el.textContent = Math.floor(state.inventory[key] || 0);
        });
        // Hotbar
        document.querySelectorAll('#hotbar .slot').forEach((slot, index) => {
            const type = slotBuildType(index);
            const def = type ? D.BUILDINGS[type] : null;
            let locked = false;
            if (index === 6) locked = !state.unlockedTechs.scanRoom;
            if (index === 7) locked = !state.unlockedTechs.droneBay;
            slot.classList.toggle('locked', locked);
            const active = state.selectedTool === index;
            slot.classList.toggle('selected', active);
            if (def) {
                const affordable = Object.entries(def.cost).every(([k, v]) => (state.inventory[k] || 0) >= v);
                slot.classList.toggle('unaffordable', !affordable);
            } else {
                slot.classList.remove('unaffordable');
            }
        });

        const def = game.getSelectedBuildingDef();
        const info = $('build-info');
        if (def) {
            info.classList.add('show');
            $('build-name').textContent = def.name.toUpperCase();
            $('build-cost').textContent = Object.entries(def.cost).map(([k, v]) => `${v} ${D.RESOURCES[k].short}`).join(' · ');
            $('build-power').textContent = `${def.power > 0 ? '+' : ''}${def.power} MW`;
            $('build-power').style.color = def.power > 0 ? 'var(--emerald)' : 'var(--rose)';
        } else {
            info.classList.remove('show');
        }

        drawMinimap();
        if (isOpen('modal-tech')) updateTechLive();
        if (isOpen('modal-journal')) renderJournal();
    }

    function rankInfo(xp) {
        let level = 1;
        while (level < XP_STEPS.length && xp >= XP_STEPS[level]) level++;
        const base = XP_STEPS[level - 1] || 0;
        const next = XP_STEPS[level] || XP_STEPS[XP_STEPS.length - 1];
        return {
            level,
            name: RANKS[Math.min(RANKS.length - 1, Math.floor((level - 1) / 2))],
            pct: next > base ? Math.min(100, ((xp - base) / (next - base)) * 100) : 100,
            next: Math.round(next)
        };
    }

    function slotBuildType(index) {
        if (index === 0 || index === 8) return null;
        const def = D.BUILD_BY_SLOT[index];
        return def ? def.type : null;
    }

    /* ------------------------------------------------------------------ */
    /* MINI-CARTE                                                          */
    /* ------------------------------------------------------------------ */
    function drawMinimap() {
        if (!state.settings.minimap) {
            $('minimap').style.display = 'none';
            return;
        }
        $('minimap').style.display = 'block';
        const canvas = $('minimap');
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#020d16';
        ctx.fillRect(0, 0, w, h);
        if (!world.mapCanvas) return;

        const span = 430;
        const mpp = world.mapCanvas.width / D.WORLD.SIZE;
        const srcW = span * mpp;
        const srcH = srcW * (h / w);
        const srcX = (game.camera.position.x + D.WORLD.HALF) * mpp - srcW / 2;
        const srcY = (D.WORLD.HALF - game.camera.position.z) * mpp - srcH / 2;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(world.mapCanvas, srcX, srcY, srcW, srcH, 0, 0, w, h);

        const toMini = (x, z) => ({
            x: ((x - game.camera.position.x) / span + 0.5) * w,
            y: ((z - game.camera.position.z) / span + 0.5) * h
        });

        // Gisements découverts
        (state.discoveredNodes || []).forEach(index => {
            const node = world.nodes[index];
            if (!node || node.stock <= 0) return;
            const p = toMini(node.position.x, node.position.z);
            if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) return;
            ctx.fillStyle = D.RESOURCES[node.resourceType].color;
            ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
        });
        // Éclats de mémoire recueillis
        (world.relics || []).forEach(relic => {
            if (!state.relics || !state.relics[relic.id]) return;
            const p = toMini(relic.position.x, relic.position.z);
            if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) return;
            ctx.fillStyle = '#d8b4fe';
            ctx.beginPath();
            ctx.moveTo(p.x, p.y - 3.5); ctx.lineTo(p.x + 3, p.y); ctx.lineTo(p.x, p.y + 3.5); ctx.lineTo(p.x - 3, p.y);
            ctx.closePath(); ctx.fill();
        });
        // Bâtiments
        state.buildings.forEach(b => {
            const p = toMini(b.position.x, b.position.z);
            if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) return;
            ctx.fillStyle = b.type === 'hub' ? '#fbbf24' : b.type === 'thermal' ? '#34d399' : '#22d3ee';
            ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
        });
        // Balise
        if (state.waypoint) {
            const p = toMini(state.waypoint.x, state.waypoint.z);
            ctx.strokeStyle = '#facc15'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(p.x - 4, p.y); ctx.lineTo(p.x + 4, p.y); ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x, p.y + 4); ctx.stroke();
        }
        // Joueur
        const cx = w / 2, cy = h / 2;
        const dir = new THREE.Vector3();
        game.camera.getWorldDirection(dir);
        const ang = Math.atan2(dir.x, -dir.z);
        ctx.save();
        ctx.translate(cx, cy); ctx.rotate(ang);
        ctx.fillStyle = '#e0fbff';
        ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill();
        ctx.restore();
        // Cadre
        ctx.strokeStyle = 'rgba(94,234,212,0.28)'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
        ctx.strokeStyle = 'rgba(94,234,212,0.14)';
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
    }

    /* ------------------------------------------------------------------ */
    /* GESTION DES MODALES                                                 */
    /* ------------------------------------------------------------------ */
    function isOpen(id) {
        const el = $(id);
        return el && !el.classList.contains('hidden');
    }

    function anyModalOpen() {
        return MODALS.some(isOpen) || isOpen('modal-victory');
    }

    const PANEL_TABS = [
        ['modal-inventory', 'Inventaire'],
        ['modal-catalog', 'Fabricateur'],
        ['modal-tech', 'Recherche'],
        ['modal-map', 'Carte'],
        ['modal-codex', 'Codex'],
        ['modal-journal', 'Journal'],
        ['modal-settings', 'Réglages'],
    ];

    function buildPanelNav(modal, id) {
        let nav = modal.querySelector('.modal-nav');
        if (!nav) {
            nav = document.createElement('div');
            nav.className = 'modal-nav';
            nav.setAttribute('role', 'navigation');
            nav.setAttribute('aria-label', 'Panneaux de la sonde');
            const tabs = document.createElement('div');
            tabs.className = 'modal-nav-tabs';
            PANEL_TABS.forEach(([target, label]) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'modal-nav-tab';
                btn.dataset.goto = target;
                btn.textContent = label;
                btn.addEventListener('click', () => openModal(target));
                tabs.appendChild(btn);
            });
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'modal-nav-close';
            close.innerHTML = '<span aria-hidden="true">✕</span> Fermer';
            close.setAttribute('aria-label', 'Fermer le panneau');
            close.addEventListener('click', () => closeModal(id));
            nav.appendChild(tabs);
            nav.appendChild(close);
            const shell = modal.querySelector('.modal-shell') || modal;
            const head = shell.querySelector('.modal-head');
            if (head && head.nextSibling) shell.insertBefore(nav, head.nextSibling);
            else shell.appendChild(nav);
        }
        nav.querySelectorAll('.modal-nav-tab').forEach(tab => {
            const active = tab.dataset.goto === id;
            tab.classList.toggle('is-active', active);
            if (active) tab.setAttribute('aria-current', 'page');
            else tab.removeAttribute('aria-current');
        });
    }

    function openModal(id) {
        // Toujours rendre le curseur disponible : les panneaux doivent être
        // utilisables à la souris sans passer par Échap.
        if (document.pointerLockElement) document.exitPointerLock();
        if (!anyModalOpen()) lastModalFocus = document.activeElement;
        MODALS.forEach(m => { if (m !== id) $(m).classList.add('hidden'); });
        const modal = $(id);
        modal.classList.remove('hidden');
        if (PANEL_TABS.some(([target]) => target === id)) buildPanelNav(modal, id);
        // Focus initial sur le premier contrôle utile, sans voler le focus
        // pendant que le panneau s'affiche.
        requestAnimationFrame(() => {
            if (!modal || modal.classList.contains('hidden')) return;
            const first = focusableIn(modal.querySelector('.modal-body') || modal)[0];
            if (first) first.focus({ preventScroll: true });
        });
        if (PP.Audio) PP.Audio.open();
        if (id === 'modal-map') requestAnimationFrame(() => { resizeMap(); drawMap(); });
        else if (id === 'modal-tech') renderTech();
        else if (id === 'modal-inventory') renderInventory();
        else if (id === 'modal-catalog') renderCatalog();
        else if (id === 'modal-journal') renderJournal();
        else if (id === 'modal-codex') renderCodex();
        else if (id === 'modal-settings') syncSettingsInputs();
        else if (id === 'modal-command') { renderCommandDeck(); setTimeout(() => { const search = $('command-search'); if (search) { search.value = ''; search.focus(); } }, 40); }
    }

    function focusableIn(modal) {
        return Array.from(modal.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(el => el.offsetParent !== null);
    }

    function restoreModalFocus() {
        const previous = lastModalFocus;
        lastModalFocus = null;
        if (previous && previous.isConnected && typeof previous.focus === 'function') {
            previous.focus({ preventScroll: true });
        }
    }

    function closeModal(id) {
        if (!id) return;
        const el = $(id);
        if (!el || el.classList.contains('hidden')) return;
        el.classList.add('hidden');
        if (PP.Audio) PP.Audio.close();
        if (id === 'modal-settings' && settingsReturn) {
            const prev = settingsReturn;
            settingsReturn = null;
            if (prev === 'modal-pause') { openModal('modal-pause'); return; }
        }
        if (id === 'modal-machine') activeMachine = null;
        // On ne reverrouille pas ici : le curseur reste libre pour enchaîner
        // les panneaux. Un clic dans l'océan reprend le pilotage.
        if (!anyModalOpen()) restoreModalFocus();
    }

    function closeAllModals() {
        MODALS.forEach(m => $(m).classList.add('hidden'));
        activeMachine = null;
        settingsReturn = null;
        if (!anyModalOpen()) restoreModalFocus();
    }

    function openPauseModal() {
        openModal('modal-pause');
        if ($('pause-session')) $('pause-session').textContent = `IMMERSION ${U.formatTime(state.stats.playTime || 0)}`;
    }

    function handleEscape() {
        if (!anyModalOpen()) return false;
        if (isOpen('modal-settings') && settingsReturn === 'modal-pause') { closeModal('modal-settings'); return true; }
        const machine = isOpen('modal-machine');
        if (machine) { closeModal('modal-machine'); return true; }
        const pause = isOpen('modal-pause');
        if (pause) { closeModal('modal-pause'); if (game.resume) game.resume(); return true; }
        const victory = isOpen('modal-victory');
        if (victory) return true;
        MODALS.forEach(m => { if (isOpen(m)) closeModal(m); });
        return true;
    }

    function openCommandDeck() {
        if (isOpen('modal-command')) { closeModal('modal-command'); return; }
        openModal('modal-command');
    }

    function renderCommandDeck() {
        if (!state) return;
        const credits = $('command-credits');
        if (credits) credits.textContent = `◈ ${Math.round(state.credits || 0)} CR`;
        const search = $('command-search');
        if (search) search.setAttribute('aria-label', 'Rechercher une commande');
    }

    function filterCommandDeck() {
        const input = $('command-search');
        const query = input ? input.value.trim().toLowerCase() : '';
        document.querySelectorAll('#command-grid .command-btn, #command-quick .command-btn').forEach(btn => {
            const text = btn.textContent.toLowerCase();
            btn.style.display = !query || text.includes(query) ? '' : 'none';
        });
    }

    function executeCommand(action) {
        if (!action) return;
        if (action === 'save') {
            if (game.saveGame) game.saveGame(true);
            renderCommandDeck();
            return;
        }
        if (action === 'surge') { closeModal('modal-command'); if (game.powerSurge) game.powerSurge(); return; }
        if (action === 'silence') { closeModal('modal-command'); if (game.silentRunning) game.silentRunning(); return; }
        if (action === 'ascent') { closeModal('modal-command'); if (game.emergencyAscent) game.emergencyAscent(); return; }
        if (action === 'autoscan') { closeModal('modal-command'); if (game.toggleAutoScan) game.toggleAutoScan(); return; }
        if (action === 'photo') { closeModal('modal-command'); if (game.togglePhotoMode) game.togglePhotoMode(); return; }
        if (action === 'marker') {
            if (game.addMapMarker) game.addMapMarker(game.camera.position.x, game.camera.position.z, 'Repère de plongée');
            renderCommandDeck();
            return;
        }
        if (action === 'repeat') { closeModal('modal-command'); if (game.repeatLastBuild) game.repeatLastBuild(); return; }
        if (action === 'help') { closeModal('modal-command'); openHelp(); return; }
        if (action === 'settings') { closeModal('modal-command'); openSettings(); return; }
        const modal = { map: 'modal-map', inventory: 'modal-inventory', tech: 'modal-tech', journal: 'modal-journal', codex: 'modal-codex', catalog: 'modal-catalog' }[action];
        if (modal) {
            closeModal('modal-command');
            openModal(modal);
        }
    }

    function openInventory() { openModal('modal-inventory'); }
    function openTech() { openModal('modal-tech'); }
    function openCatalog() { openModal('modal-catalog'); }
    function openJournal() { openModal('modal-journal'); }
    function openCodex() { openModal('modal-codex'); }
    function openSettings() { settingsReturn = null; openModal('modal-settings'); }
    function openHelp() { settingsReturn = null; openModal('modal-help'); }

    /* ------------------------------------------------------------------ */
    /* INVENTAIRE / FABRICATION                                            */
    /* ------------------------------------------------------------------ */
    function resourceUses(key) {
        const uses = [];
        D.HAND_RECIPES.forEach(r => { if (r.cost[key]) uses.push(r.name); });
        Object.values(D.SMELTER_RECIPES).forEach(r => { if (r.in[key] || r.out === key) uses.push(r.name); });
        D.BUILD_LIST.forEach(b => { if (b.cost[key]) uses.push(b.name); });
        D.TECHS.forEach(t => { if (t.cost[key]) uses.push(t.name); });
        (state.contracts || []).forEach(c => { if (c.key === key) uses.push(c.name); });
        return [...new Set(uses)].slice(0, 7);
    }

    function renderInvDetail() {
        const el = $('inv-detail');
        if (!el) return;
        if (!invSelected || !D.RESOURCES[invSelected]) {
            el.innerHTML = 'Sélectionnez une ressource pour voir ses usages industriels. <span class="use">Les filtres séparent les matières brutes des composants raffinés.</span>';
            return;
        }
        const info = D.RESOURCES[invSelected];
        const uses = resourceUses(invSelected);
        el.innerHTML = `<b style="color:${info.color}">${info.name}</b> · ${Math.floor(state.inventory[invSelected] || 0)} en stock · ${info.tier === 'raw' ? 'MATIÈRE BRUTE' : 'COMPOSANT RAFFINÉ'}<br>${info.desc}${uses.length ? `<br><span class="use">UTILISÉ DANS :</span> ${uses.join(' · ')}` : ''}`;
    }

    function renderInventory() {
        const total = D.RESOURCE_ORDER.reduce((sum, k) => sum + (state.inventory[k] || 0), 0);
        $('inv-total').textContent = `${total} UNITÉS`;
        const grid = $('inv-grid');
        const keys = D.RESOURCE_ORDER.filter(key => {
            if (invFilter !== 'all' && D.RESOURCES[key].tier !== invFilter) return false;
            if (!invSearch) return true;
            const info = D.RESOURCES[key];
            return `${info.name} ${info.short} ${info.desc}`.toLowerCase().includes(invSearch);
        });
        grid.innerHTML = keys.map(key => {
            const info = D.RESOURCES[key];
            const qty = Math.floor(state.inventory[key] || 0);
            const dim = qty > 0 ? '' : 'opacity:.4;';
            return `<div class="inv-cell ${invSelected === key ? 'selected' : ''}" data-res-key="${key}" role="button" tabindex="0" style="${dim}" title="${info.desc}">
                <span class="ic-name" style="color:${qty > 0 ? info.color : 'var(--muted)'}">${info.name}</span>
                <span class="ic-count">${qty}</span>
                <div class="ic-bar"><i style="width:${Math.min(100, qty * 2)}%;background:${info.color}"></i></div>
            </div>`;
        }).join('');
        $('inv-slots').textContent = `${D.RESOURCE_ORDER.filter(k => (state.inventory[k] || 0) > 0).length} / 19`;
        document.querySelectorAll('#inv-filters .chip').forEach(el => {
            el.classList.toggle('active', el.dataset.filter === invFilter);
            el.classList.toggle('ok', el.dataset.filter === invFilter);
        });
        renderInvDetail();

        let ready = 0;
        $('recipe-list').innerHTML = D.HAND_RECIPES.map(recipe => {
            const locked = recipe.tech && !state.unlockedTechs[recipe.tech];
            const can = !locked && Object.entries(recipe.cost).every(([k, v]) => (state.inventory[k] || 0) >= v);
            if (can) ready++;
            const cost = Object.entries(recipe.cost).map(([k, v]) => `${v} ${D.RESOURCES[k].short}`).join(' + ');
            const out = Object.entries(recipe.out).map(([k, v]) => `${v} ${D.RESOURCES[k].name}`).join(' + ');
            return `<button class="recipe" data-craft="${recipe.id}" ${can ? '' : 'disabled'}>
                <span class="r-icon">${locked ? '⌑' : '⚗'}</span>
                <span class="r-main"><span class="r-name">${recipe.name}</span><span class="r-cost">${cost}${locked ? ' · RECHERCHE REQUISE' : ''}</span></span>
                <span class="r-out">${out}</span><span class="r-go">${can ? 'FABRIQUER' : '—'}</span>
            </button>`;
        }).join('');
        $('craft-ready').textContent = `${ready} PRÊTES`;
        const batchBtn = $('btn-batch-craft');
        if (batchBtn) {
            batchBtn.classList.toggle('active', batchCraft);
            batchBtn.textContent = batchCraft ? '×5 ACTIVÉ' : '×5';
            batchBtn.title = batchCraft ? 'Désactiver la fabrication par lot de 5' : 'Fabriquer 5 unités par clic';
        }
        const note = $('batch-note');
        if (note) note.textContent = batchCraft ? 'LOT ×5 — utilise 5× les ressources' : 'Lot ×5 désactivé';
    }

    function moduleUpgradeEffect(b) {
        const level = b.level || 1;
        const next = level + 1;
        if (next > 3) return 'Niveau maximal atteint.';
        switch (b.type) {
            case 'drill': return `Cadence +18 % · stockage +20 unités (Mk.${next})`;
            case 'smelter': return `Cycle de raffinage −13 % · sortie +20 unités (Mk.${next})`;
            case 'thermal': return `Production +25 % · ${Math.round((Number.isInteger(b.linkedVentId) && b.linkedVentId >= 0 ? 70 : 30) * Math.pow(1.25, next - 1))} MW (Mk.${next})`;
            case 'reactor': return `Production +20 % · charge réseau stabilisée (Mk.${next})`;
            case 'garden': return `Croissance +15 %${next >= 3 ? ' · +1 biofibre par cycle' : ''} (Mk.${next})`;
            case 'storage': return `Capacité +60 unités · transfert accéléré (Mk.${next})`;
            case 'scanner': return `Rayon de scan +18 % (Mk.${next})`;
            case 'droneBay': return `Cargaison +2 unités · vitesse +5 m/s (Mk.${next})`;
            case 'habitat': return `Rayon de ravitaillement +5 m · recharge accélérée (Mk.${next})`;
            default: return `Débit et rendement accrus (Mk.${next})`;
        }
    }

    function renderMachine(b) {
        activeMachine = b;
        if (!b) return;
        const level = b.level || 1;
        $('machine-title').textContent = `${b.name} · Mk.${level}`;
        $('machine-power').textContent = `${b.power > 0 ? '+' : ''}${b.power} MW · EFFICACITÉ ${Math.round(state.powerEfficiency * 100)}%`;
        const body = $('machine-body');
        const statusLine = `<div class="machine-status">ÉTAT : <b>${b.power < 0 && state.powerEfficiency < 0.99 ? 'SOUS-ALIMENTÉ' : 'OPÉRATIONNEL'}</b> · ${b.power > 0 ? 'PRODUCTION' : 'CONSOMMATION'} ${Math.abs(b.power)} MW · MK.${level} · ID ${String(b.id).padStart(3, '0')}</div>`;
        let html = statusLine;

        if (b.type === 'hub' || b.type === 'habitat') {
            html += `<p style="font-size:12.5px;line-height:1.6;color:#b9dae3">Module pressurisé. À moins de ${17 + (level - 1) * 5} m, votre combinaison recharge son oxygène et répare lentement sa coque.</p>
                <div class="buffer-grid">
                    <div class="buffer-box"><div class="bb-title">OXYGÈNE</div><div class="bb-items">${Math.ceil(state.o2)} / ${state.maxO2} s</div></div>
                    <div class="buffer-box"><div class="bb-title">COQUE</div><div class="bb-items">${Math.ceil(state.hull)} % · seuil ${state.maxCrushDepth} m</div></div>
                </div>
                <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
                    <button class="btn sm" data-machine-action="repair">⌁ Réparer la coque (1 Biogel)</button>
                    <button class="btn sm ghost" data-machine-action="refill">◌ Recharger l'O₂</button>
                </div>`;
                if (b.type === 'hub') {
                    html += `<div class="divider"></div><div class="micro" style="line-height:1.7">La capsule centrale collecte automatiquement les ressources livrées par les convoyeurs et les drones. C'est votre entrepôt principal.</div>`;
                }
        } else if (b.type === 'drill') {
            const node = Number.isInteger(b.linkedNodeId) ? world.nodes[b.linkedNodeId] : null;
            html += `<p style="font-size:12.5px;color:#b9dae3">Forage continu sur : <b style="color:var(--teal)">${node ? D.RESOURCES[node.resourceType].name : 'aucun gisement'}</b></p>
                <div class="buffer-grid">
                    <div class="buffer-box"><div class="bb-title">RÉSERVE DU FILON</div><div class="bb-items">${node ? `${node.stock} / ${node.maxStock}` : '—'}</div></div>
                    <div class="buffer-box"><div class="bb-title">STOCK DE SORTIE</div><div class="bb-items">${Object.entries(b.outputBuffer).map(([k, v]) => `${v} ${D.RESOURCES[k].short}`).join(' · ') || 'Vide'}</div></div>
                </div>
                <div class="progress-line"><span class="micro">CYCLE</span><div class="bar"><i style="width:${Math.round((b.progress / ((state.unlockedTechs.drillMk2 ? 1.8 : 3) * Math.pow(0.82, level - 1) / (1 + (state.relicBuffs.drill || 0)))) * 100)}%"></i></div></div>
                <div style="margin-top:9px"><button class="btn sm ghost" data-machine-action="locate-node">⌖ Localiser le filon sur la carte</button></div>`;
        } else if (b.type === 'smelter') {
            html += `<div class="buffer-grid">
                <div class="buffer-box"><div class="bb-title">ENTRÉES</div><div class="bb-items">${Object.entries(b.inputBuffer).map(([k, v]) => `${v} ${D.RESOURCES[k].short}`).join(' · ') || 'Vide'}</div></div>
                <div class="buffer-box"><div class="bb-title">SORTIES</div><div class="bb-items">${Object.entries(b.outputBuffer).map(([k, v]) => `${v} ${D.RESOURCES[k].short}`).join(' · ') || 'Vide'}</div></div>
            </div>
            <div class="divider"></div>
            <div class="eyebrow" style="margin-bottom:6px">RECETTE DU CREUSET</div>
            <div>`;
            Object.values(D.SMELTER_RECIPES).forEach(recipe => {
                const locked = recipe.tech && !state.unlockedTechs[recipe.tech];
                const active = b.recipe === recipe.id;
                html += `<button class="recipe-option ${active ? 'active' : ''}" data-recipe="${recipe.id}" ${locked ? 'disabled' : ''}>
                    <span class="r-icon">${active ? '◉' : '◇'}</span>
                    <span style="flex:1"><span class="ro-name">${recipe.name}</span><div class="ro-cost">${Object.entries(recipe.in).map(([k, v]) => `${v} ${D.RESOURCES[k].short}`).join(' + ')} → ${D.RESOURCES[recipe.out].name} · ${recipe.time}s ${locked ? '· RECHERCHE' : ''}</div></span>
                    <span class="micro">${active ? 'ACTIF' : 'CHOISIR'}</span>
                </button>`;
            });
            html += `</div>`;
        } else if (b.type === 'thermal') {
            html += `<p style="font-size:12.5px;line-height:1.6;color:#b9dae3">Production électrique : <b style="color:var(--emerald)">+${b.power} MW</b>${b.power > 30 ? ' · bonus hydrothermal actif (+70 MW)' : ''}.</p>
                <div class="buffer-grid"><div class="buffer-box"><div class="bb-title">RÉSEAU</div><div class="bb-items">${state.powerProduced} MW produits · ${state.powerConsumed} MW consommés</div></div>
                <div class="buffer-box"><div class="bb-title">RENDEMENT</div><div class="bb-items">${Math.round(state.powerEfficiency * 100)} %</div></div></div>`;
        } else if (b.type === 'scanner') {
            const revealed = (state.discoveredNodes || []).length;
            html += `<p style="font-size:12.5px;line-height:1.6;color:#b9dae3">Le dôme sonar balaie un rayon de ${Math.round(620 * Math.pow(1.18, level - 1))} m toutes les six secondes. Les gisements détectés apparaissent durablement sur la carte.</p>
                <div class="buffer-grid"><div class="buffer-box"><div class="bb-title">GISEMENTS CARTOGRAPHIÉS</div><div class="bb-items">${revealed} filons</div></div>
                <div class="buffer-box"><div class="bb-title">PROCHAIN BALAYAGE</div><div class="bb-items">${Math.max(0, 6 - (b.scanTimer || 0)).toFixed(1)} s</div></div></div>`;
        } else if (b.type === 'droneBay') {
            const drone = state.drones.find(d => d.bayId === b.id);
            html += `<p style="font-size:12.5px;line-height:1.6;color:#b9dae3">Un drone cargo autonome est assigné à cette baie. Il choisit le filon le plus proche dans un rayon de 900 m et rapporte ${4 + (level - 1) * 2} unités par trajet.</p>
                <div class="buffer-grid"><div class="buffer-box"><div class="bb-title">DRONE</div><div class="bb-items">${drone ? drone.state.toUpperCase() : 'AUCUN'}</div></div>
                <div class="buffer-box"><div class="bb-title">CARGAISON</div><div class="bb-items">${drone && drone.cargo ? `${drone.cargoQty} ${D.RESOURCES[drone.cargo].short}` : 'Vide'}</div></div></div>`;
        } else if (b.type === 'garden') {
            html += `<p style="font-size:12.5px;line-height:1.6;color:#b9dae3">Jardin hydroponique automatisé. Produit ${2 + (level >= 3 ? 1 : 0)} biofibres toutes les ${(9 * Math.pow(0.85, level - 1)).toFixed(1)} s. Alimentez-le en énergie.</p>
                <div class="buffer-grid"><div class="buffer-box"><div class="bb-title">SORTIE</div><div class="bb-items">${Object.entries(b.outputBuffer).map(([k, v]) => `${v} ${D.RESOURCES[k].short}`).join(' · ') || 'Vide'}</div></div>
                <div class="buffer-box"><div class="bb-title">CYCLE</div><div class="bb-items">${Math.round((b.progress / 9) * 100)} %</div></div></div>`;
        } else if (b.type === 'storage') {
            html += `<p style="font-size:12.5px;line-height:1.6;color:#b9dae3">Tampon logistique de ${60 * level} unités. S'il se trouve à moins de 80 m de la capsule, il transfère automatiquement son contenu vers le stockage central toutes les ${(3 / level).toFixed(1)} s.</p>
                <div class="buffer-box" style="margin-top:9px"><div class="bb-title">CONTENU</div><div class="bb-items">${Object.entries(b.outputBuffer).map(([k, v]) => `${v} ${D.RESOURCES[k].name}`).join('<br>') || 'Vide'}</div></div>`;
        } else if (b.type === 'reactor') {
            html += `<p style="font-size:12.5px;line-height:1.6;color:#b9dae3">Réacteur xéno : +${b.power} MW. Le confinement stabilise la matière xéno et alimente l'ensemble du réseau industriel.</p>
                <div class="buffer-grid"><div class="buffer-box"><div class="bb-title">PRODUCTION</div><div class="bb-items">${state.powerProduced} MW</div></div><div class="buffer-box"><div class="bb-title">CHARGE</div><div class="bb-items">${state.powerConsumed} MW</div></div></div>`;
        }

        if (b.type !== 'hub') {
            const cost = level < 3 && game.factory && game.factory.upgradeCost ? game.factory.upgradeCost(b) : null;
            const techReady = level >= 2 ? !!state.unlockedTechs.xenoPower : !!state.unlockedTechs.metallurgy;
            const affordable = !!cost && Object.entries(cost).every(([k, v]) => (state.inventory[k] || 0) >= v);
            const costLabel = cost ? Object.entries(cost).map(([k, v]) => `${v} ${D.RESOURCES[k].short}`).join(' · ') : '';
            html += `<div class="divider"></div>
                <div class="eyebrow" style="margin-bottom:6px">AMÉLIORATION DU MODULE</div>`;
            if (level >= 3) {
                html += `<div class="machine-status">NIVEAU MAXIMAL · Mk.III</div>`;
            } else {
                html += `<p style="font-size:12px;line-height:1.55;color:#b9dae3;margin:0 0 7px">${moduleUpgradeEffect(b)}</p>
                    <div class="micro" style="display:flex;justify-content:space-between;gap:8px;margin-bottom:7px"><span>COÛT : <b style="color:${affordable ? 'var(--emerald)' : 'var(--rose)'}">${costLabel}</b></span><span>TECH : <b style="color:${techReady ? 'var(--teal)' : 'var(--rose)'}">${level >= 2 ? 'CONFINEMENT XÉNO' : 'MÉTALLURGIE'}</b></span></div>
                    <button class="btn sm" data-machine-action="upgrade" style="width:100%;margin-bottom:8px" ${!techReady ? 'disabled' : ''}>ÉLEVER AU NIVEAU MK.${level + 1}</button>`;
            }
            html += `<button class="btn sm danger" data-machine-action="dismantle" style="width:100%">DÉMONTER LE MODULE · RÉCUPÉRATION 80 %</button>`;
        }
        body.innerHTML = html;
        openModal('modal-machine');
    }

    /* ------------------------------------------------------------------ */
    /* TECHNOLOGIES                                                        */
    /* ------------------------------------------------------------------ */
    function renderTech() {
        const tiers = [1, 2, 3, 4];
        const grid = $('tech-tiers');
        grid.innerHTML = tiers.map(tier => {
            const techs = D.TECHS.filter(t => t.tier === tier);
            return `<div class="tech-tier">
                <div class="tech-tier-head"><b>PALIER ${tier}</b><span>${techs.filter(t => state.unlockedTechs[t.id]).length} / ${techs.length}</span></div>
                ${techs.map(tech => {
                    const unlocked = !!state.unlockedTechs[tech.id];
                    const missing = (tech.requires || []).filter(id => !state.unlockedTechs[id]);
                    const affordable = Object.entries(tech.cost).every(([k, v]) => (state.inventory[k] || 0) >= v);
                    const locked = missing.length > 0;
                    const stateCls = unlocked ? 'unlocked' : locked ? 'locked' : affordable ? 'available' : '';
                    const cost = Object.entries(tech.cost).map(([k, v]) => `${v} ${D.RESOURCES[k].short}`).join(' · ');
                    return `<button class="tech-card ${stateCls}" data-tech="${tech.id}" ${unlocked || locked || !affordable ? 'disabled' : ''}>
                        <div class="tc-top"><span class="tc-icon">${tech.icon}</span><span class="tc-name">${tech.name}</span></div>
                        <div class="tc-desc">${tech.desc}</div>
                        <div class="tc-cost">${unlocked ? '✓ ACQUIS' : locked ? 'REQUIS : ' + missing.map(id => D.TECH_BY_ID[id] ? D.TECH_BY_ID[id].name : id).join(' · ') : cost}</div>
                    </button>`;
                }).join('')}
            </div>`;
        }).join('');

        const unlockedCount = Object.keys(state.unlockedTechs).length;
        $('tech-count').textContent = `${unlockedCount} / ${D.TECHS.length}`;
        $('tech-progress-fill').style.width = `${(unlockedCount / D.TECHS.length) * 100}%`;
        updateTechLive();
    }

    function updateTechLive() {
        if (!state) return;
        const active = state.buildings.length;
        const drones = state.drones.length;
        const pipes = state.pipes.length;
        $('factory-stats').textContent = `${active} BÂTIMENTS · ${pipes} CONVOYEURS · ${drones} DRONES`;
        $('tech-depth').textContent = `COQUE : ${state.maxCrushDepth} M`;
        const hasProtocol = !!state.unlockedTechs.orbitalProtocol;
        const cores = state.inventory.xenoCore || 0;
        const extraOk = Object.entries(D.BEACON_EXTRA_COST).every(([k, v]) => (state.inventory[k] || 0) >= v);
        const canLaunch = hasProtocol && cores >= D.XENO_CORE_REQUIRED && extraOk && !state.gameWon;
        $('beacon-status').textContent = !hasProtocol
            ? `Protocole orbital requis · ${cores} / ${D.XENO_CORE_REQUIRED} noyaux xéno`
            : `Noyaux : ${cores} / ${D.XENO_CORE_REQUIRED} · ${Object.entries(D.BEACON_EXTRA_COST).map(([k, v]) => `${v} ${D.RESOURCES[k].short}`).join(' · ')}`;
        $('btn-beacon').disabled = !canLaunch;
        $('btn-beacon').classList.toggle('disabled', !canLaunch);
    }

    /* ------------------------------------------------------------------ */
    /* CATALOGUE DE CONSTRUCTION                                            */
    /* ------------------------------------------------------------------ */
    function renderCatalog() {
        const list = $('catalog-list');
        list.innerHTML = D.BUILD_LIST.map(def => {
            const locked = def.tech && !state.unlockedTechs[def.tech];
            const selected = game.getSelectedBuildingDef() && game.getSelectedBuildingDef().type === def.type;
            const affordable = Object.entries(def.cost).every(([k, v]) => (state.inventory[k] || 0) >= v);
            const cost = Object.entries(def.cost).map(([k, v]) => `${v} ${D.RESOURCES[k].short}`).join(' · ');
            return `<button class="catalog-card ${locked ? 'locked' : ''} ${selected ? 'current' : ''}" data-build="${def.type}" ${locked ? 'disabled' : ''}>
                <div class="cc-top"><span class="cc-icon">${def.icon}</span><span class="chip ${affordable ? 'ok' : 'warn'}">${affordable ? 'PRÊT' : 'MANQUE'}</span></div>
                <div class="cc-name">${def.name}</div>
                <div class="cc-desc">${def.desc}</div>
                <div class="cc-cost">${cost}</div>
                <div class="cc-foot"><span>${def.power > 0 ? '+' : ''}${def.power} MW</span><span>${locked ? 'RECHERCHE' : def.slot ? `TOUCHE ${def.slot + 1}` : 'CATALOGUE'}</span></div>
            </button>`;
        }).join('');
        $('catalog-power').textContent = `RÉSEAU ${state.powerConsumed} / ${state.powerProduced} MW`;
    }

    /* ------------------------------------------------------------------ */
    /* JOURNAL                                                             */
    /* ------------------------------------------------------------------ */
    function getTrack(mission) {
        try {
            if (state.gameWon && mission.id === 'm8') return { cur: 1, max: 1 };
            return mission.track ? mission.track(state) : { cur: 0, max: 1 };
        } catch (error) { return { cur: 0, max: 1 }; }
    }

    function getActiveMission() {
        if (!state) return null;
        for (let i = 0; i < D.MAIN_MISSIONS.length; i++) {
            const mission = D.MAIN_MISSIONS[i];
            if (state.completedMain && state.completedMain.includes(mission.id)) continue;
            return { mission, track: getTrack(mission), index: i };
        }
        return null;
    }

    function renderColonyDashboard() {
        const wrap = $('colony-dashboard');
        if (!wrap || !state) return;
        const industrial = (state.buildings || []).filter(b => b.type !== 'hub');
        const deficit = (state.powerConsumed || 0) > (state.powerProduced || 0);
        const unconnectedDrills = industrial.filter(b => b.type === 'drill' && !(state.pipes || []).some(p => p.fromId === b.id || p.toId === b.id));
        const drones = state.drones || [];
        const activeDrones = drones.filter(d => d && d.state && d.state !== 'idle').length;
        const alerts = [];
        if (deficit) alerts.push('Réseau sous-alimenté : réduisez la charge ou ajoutez une prise géothermique.');
        if (unconnectedDrills.length) alerts.push(`${unconnectedDrills.length} foreuse(s) sans convoyeur : reliez-les au hub ou à une fonderie.`);
        if (!industrial.length) alerts.push('Aucun module industriel : construisez une foreuse et une fonderie pour lancer la colonie.');
        const efficiency = state.powerEfficiency === undefined ? 100 : Math.round(state.powerEfficiency * 100);
        const cells = [
            ['PRODUCTION', `${Math.round(state.powerProduced || 0)} MW`, 'var(--emerald)'],
            ['CONSOMMATION', `${Math.round(state.powerConsumed || 0)} MW`, deficit ? 'var(--rose)' : 'var(--ice)'],
            ['EFFICACITÉ', `${efficiency} %`, deficit ? 'var(--amber)' : 'var(--teal)'],
            ['MODULES', `${industrial.length}`, 'var(--ice)'],
            ['DRONES', `${activeDrones} / ${drones.length}`, 'var(--cyan)'],
            ['CONVOYEURS', `${(state.pipes || []).length}`, 'var(--amber)'],
            ['COQUE', `${Math.ceil(state.hull || 0)} %`, state.hull < 30 ? 'var(--rose)' : 'var(--ice)'],
            ['PROFONDEUR RECORD', `${Math.round(state.stats.maxDepth || 0)} m`, 'var(--violet)']
        ];
        wrap.innerHTML = cells.map(([label, value, color]) => `<div class="record-cell"><span>${label}</span><b style="color:${color}">${value}</b></div>`).join('');
        const status = $('colony-alert');
        if (status) {
            status.textContent = alerts.length ? 'ATTENTION' : 'NOMINAL';
            status.style.color = alerts.length ? 'var(--rose)' : 'var(--emerald)';
        }
        const hint = $('colony-hint');
        if (hint) hint.textContent = alerts.length ? alerts.join(' · ') : 'Réseau stable, chaîne de production connectée et modules opérationnels.';
    }

    function renderJournal() {
        const mainWrap = $('journal-main');
        if (!mainWrap) return;
        renderColonyDashboard();
        const completed = new Set(state.completedMain || []);
        const active = getActiveMission();
        mainWrap.innerHTML = D.MAIN_MISSIONS.map((mission, index) => {
            const done = completed.has(mission.id) || (mission.id === 'm8' && state.gameWon);
            const track = done ? { cur: 1, max: 1 } : getTrack(mission);
            const isActive = active && active.mission.id === mission.id;
            return `<div class="mission ${done ? 'done' : isActive ? 'active' : ''}">
                <div class="m-top"><span class="m-name">${mission.chapter}. ${mission.name}</span><span class="m-chapter">${isActive ? 'EN COURS' : done ? 'TERMINÉ' : 'VERROUILLÉ'}</span></div>
                <div class="m-desc">${mission.desc}</div>
                <div class="m-obj">${mission.objective} · ${track.cur} / ${track.max}</div>
                <div class="m-reward">RÉCOMPENSE : ${Object.entries(mission.reward || {}).map(([k, v]) => `${v} ${D.RESOURCES[k].short}`).join(' · ') || '—'} · +${mission.xp} XP</div>
                <div class="bar m-bar ${done ? 'amber' : ''}"><i style="width:${done ? 100 : Math.min(100, (track.cur / Math.max(1, track.max)) * 100)}%"></i></div>
                ${isActive && mission.target ? `<button class="btn sm ghost mission-track" data-track-mission="${mission.id}">⌖ SUIVRE L'OBJECTIF</button>` : ''}
            </div>`;
        }).join('');
        $('journal-main-count').textContent = `${D.MAIN_MISSIONS.filter(m => completed.has(m.id) || (m.id === 'm8' && state.gameWon)).length} / ${D.MAIN_MISSIONS.length}`;
        const completedSide = new Set(state.completedSide || []);
        $('journal-side').innerHTML = D.SIDE_MISSIONS.map(mission => {
            const done = completedSide.has(mission.id);
            const track = getTrack(mission);
            return `<div class="mission ${done ? 'done' : ''}">
                <div class="m-top"><span class="m-name">${mission.name}</span><span class="m-chapter">${done ? 'ACCOMPLI' : 'OPÉRATION'}</span></div>
                <div class="m-desc">${mission.desc}</div>
                <div class="m-obj">${mission.objective} · ${track.cur} / ${track.max}</div>
                <div class="bar m-bar"><i style="width:${done ? 100 : Math.min(100, (track.cur / Math.max(1, track.max)) * 100)}%"></i></div>
                ${done ? '<span class="m-check">✓</span>' : ''}
            </div>`;
        }).join('');
        $('journal-side-count').textContent = `${completedSide.size} / ${D.SIDE_MISSIONS.length}`;
        $('journal-progress').textContent = `${completed.size} / ${D.MAIN_MISSIONS.length}`;

        const contracts = state.contracts || [];
        const contractWrap = $('journal-contracts');
        if (contractWrap) {
            contractWrap.innerHTML = contracts.length ? contracts.map(contract => {
                const info = D.RESOURCES[contract.key];
                const have = Math.floor(state.inventory[contract.key] || 0);
                const can = have >= contract.qty;
                return `<div class="mission ${can ? 'active' : ''}">
                    <div class="m-top"><span class="m-name">${escapeHtml(contract.name)}</span><span class="m-chapter">${escapeHtml(contract.client)}</span></div>
                    <div class="m-desc">Livraison à la capsule centrale. Le stock est décompté immédiatement.</div>
                    <div class="m-obj">${contract.qty} × ${info.name} · stock ${have} / ${contract.qty}</div>
                    <div class="m-reward">RÉCOMPENSE : ${Object.entries(contract.reward).map(([k, v]) => `${v} ${D.RESOURCES[k].short}`).join(' · ')} · +${contract.xp} XP</div>
                    <div class="bar m-bar"><i style="width:${Math.min(100, (have / contract.qty) * 100)}%"></i></div>
                    <button class="btn sm ${can ? 'primary' : 'ghost'} contract-deliver" data-contract="${contract.id}" ${can ? '' : 'disabled'} style="margin-top:6px">${can ? 'LIVRER LE CONTRAT' : 'RESSOURCES INSUFFISANTES'}</button>
                </div>`;
            }).join('') : '<div class="micro" style="padding:8px">Aucun contrat disponible. Explorez ou débloquez une technologie pour élargir le catalogue.</div>';
        }
        const contractCount = $('journal-contract-count');
        if (contractCount) contractCount.textContent = `${state.stats.contractsDone || 0} LIVRÉ${(state.stats.contractsDone || 0) > 1 ? 'S' : ''}`;

        renderMarket();
        renderRecords();
    }

    function renderMarket() {
        const credits = $('market-credits');
        if (credits) credits.textContent = `◈ ${Math.round(state.credits || 0)} CR`;
        const buyWrap = $('market-buy');
        if (buyWrap) {
            const offers = [
                ['bioGel', 38, 'Kit de réparation immédiat'],
                ['lithiumCell', 26, 'Cellule de secours'],
                ['glassPane', 20, 'Hublot de rechange'],
                ['magnetCoil', 44, 'Bobine pour drone'],
                ['thermicAlloy', 52, 'Alliage haute température']
            ];
            buyWrap.innerHTML = offers.map(([key, price, why]) => {
                const affordable = (state.credits || 0) >= price;
                return `<div class="market-row"><span><b>${D.RESOURCES[key].name}</b><br>${why}</span><span style="display:flex;gap:6px;align-items:center"><b style="color:#fde047">${price} CR</b><button class="btn sm ${affordable ? 'primary' : 'ghost'}" data-buy="${key}" ${affordable ? '' : 'disabled'}>ACHETER</button></span></div>`;
            }).join('');
        }
        const sellWrap = $('market-sell');
        if (sellWrap) {
            const stock = D.RESOURCE_ORDER.filter(key => (state.inventory[key] || 0) > 0).slice(0, 10);
            sellWrap.innerHTML = stock.length ? stock.map(key => {
                const have = Math.floor(state.inventory[key] || 0);
                const value = game.marketValue ? game.marketValue(key) : 5;
                return `<div class="market-row"><span><b>${D.RESOURCES[key].name}</b><br>stock ${have} · ${value} CR/unité</span><span style="display:flex;gap:6px;align-items:center"><button class="btn sm ghost" data-sell="${key}" data-sell-qty="1">VENDRE 1</button><button class="btn sm ghost" data-sell="${key}" data-sell-qty="5" ${have >= 5 ? '' : 'disabled'}>×5</button></span></div>`;
            }).join('') : '<div class="micro" style="padding:8px">Aucune ressource à vendre pour le moment.</div>';
        }
    }

    function renderRecords() {
        const wrap = $('journal-records');
        if (!wrap) return;
        const stats = state.stats || {};
        const records = [
            ['PROFONDEUR RECORD', `${Math.round(stats.maxDepth || 0)} m`],
            ['DISTANCE PARCOURUE', `${(stats.distance / 1000 || 0).toFixed(1)} km`],
            ['GISEMENTS EXTRAITS', `${Math.round(stats.mined || 0)}`],
            ['ÉPAVES FOUILLÉES', `${Object.keys(state.cacheTaken || {}).length} / 12`],
            ['CONTRATS LIVRÉS', `${stats.contractsDone || 0}`],
            ['ÉCLATS DE MÉMOIRE', `${Object.keys(state.relics || {}).length} / ${D.RELICS.length}`],
            ['RÉGIONS VISITÉES', `${Object.keys(state.visitedRegions || {}).length} / 10`],
            ['TEMPS D\'IMMERSION', U.formatTime(stats.playTime || 0)]
        ];
        wrap.innerHTML = records.map(([label, value]) => `<div class="record-cell"><span>${label}</span><b>${value}</b></div>`).join('');
    }

    /* ------------------------------------------------------------------ */
    /* CODEX                                                               */
    /* ------------------------------------------------------------------ */
    function renderCodex() {
        if (activeCodexCat === 'achievements') {
            $('codex-layout').classList.add('hidden');
            $('achievements-wrap').classList.remove('hidden');
            renderAchievements();
            return;
        }
        $('codex-layout').classList.remove('hidden');
        $('achievements-wrap').classList.add('hidden');
        const entries = D.CODEX.filter(c => c.cat === activeCodexCat);
        const unlocked = state.codex || {};
        const count = entries.filter(e => unlocked[e.id]).length;
        $('codex-cat-count').textContent = `${count} / ${entries.length} ENTRÉES`;
        $('codex-cat-list').innerHTML = entries.map(entry => {
            const isUnlocked = !!unlocked[entry.id];
            const active = activeCodexId === entry.id;
            return `<button class="codex-item ${active ? 'active' : ''} ${isUnlocked ? '' : 'locked'}" data-codex="${entry.id}">${isUnlocked ? entry.title : 'Signal non identifié'}</button>`;
        }).join('');
        const total = D.CODEX.filter(e => unlocked[e.id]).length;
        $('codex-count').textContent = `${total} / ${D.CODEX.length}`;

        const selected = D.CODEX_BY_ID[activeCodexId];
        const reader = $('codex-reader');
        if (selected && unlocked[selected.id]) {
            reader.innerHTML = `<span class="eyebrow">${D.CODEX_CATS[selected.cat].toUpperCase()} · ENREGISTRÉ</span>
                <h3>${selected.title}</h3>
                <div class="cr-meta">ARCHIVE THALASSA-IV · ${selected.id.toUpperCase()}</div>
                <p>${selected.text}</p>`;
        } else {
            reader.innerHTML = `<div class="codex-empty"><div style="font-size:28px;color:var(--teal);opacity:.5">? ? ?</div><div>Entrée non découverte</div><p style="font-size:11px;max-width:280px;color:var(--muted)">Explorez les profondeurs, scannez la faune et approchez-vous des monuments pour compléter cette archive.</p></div>`;
        }
        document.querySelectorAll('#codex-tabs .tab').forEach(tab => {
            tab.classList.toggle('active', tab.getAttribute('data-tab') === activeCodexCat);
        });
    }

    function renderAchievements() {
        const unlocked = state.achievements || {};
        $('achievements-list').innerHTML = D.ACHIEVEMENTS.map(ach => {
            const done = !!unlocked[ach.id];
            return `<div class="ach ${done ? 'done' : ''}">
                <div class="a-ico">${done ? '✓' : '◇'}</div>
                <div><div class="a-name">${ach.name}</div><div class="a-desc">${ach.desc}</div></div>
            </div>`;
        }).join('');
    }

    /* ------------------------------------------------------------------ */
    /* CARTE                                                               */
    /* ------------------------------------------------------------------ */
    function openMap() {
        if (!world.mapCanvas) return;
        mapView.cx = game.camera.position.x;
        mapView.cz = game.camera.position.z;
        mapView.zoom = 1.05;
        mapPoiTarget = null;
        openModal('modal-map');
        renderPoiList();
        renderMapMarkers();
        renderMapInspector();
    }

    function renderMapMarkers() {
        const list = $('map-marker-list');
        if (!list) return;
        const markers = state.mapMarkers || [];
        list.innerHTML = markers.map((m, i) => `<button class="chip" data-marker="${i}" title="X ${Math.round(m.x)} · Z ${Math.round(m.z)}">⌖ ${escapeHtml(m.label || `M${i + 1}`)}</button>`).join('') +
            (markers.length ? '<button class="chip" id="map-marker-clear" title="Effacer tous les marqueurs">✕ EFFACER</button>' : '');
    }

    function resizeMap() {
        const canvas = $('map-canvas');
        if (!canvas) return;
        const rect = canvas.parentElement.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(320, Math.floor(rect.width * dpr));
        canvas.height = Math.max(300, Math.floor(rect.height * dpr));
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
    }

    function mapTransform() {
        const canvas = $('map-canvas');
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = canvas.width / dpr, h = canvas.height / dpr;
        const scale = Math.min(w, h) / (D.WORLD.SIZE * 1.04) * mapView.zoom;
        return { w, h, scale, ox: w / 2 - mapView.cx * scale, oy: h / 2 + mapView.cz * scale };
    }

    function worldToMap(x, z, t) {
        return { x: t.ox + x * t.scale, y: t.oy - z * t.scale };
    }

    function screenToWorld(mx, my, t) {
        return { x: (mx - t.ox) / t.scale, z: -(my - t.oy) / t.scale };
    }

    function drawMap() {
        if (!isOpen('modal-map')) return;
        const canvas = $('map-canvas');
        const ctx = canvas.getContext('2d');
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const t = mapTransform();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, t.w, t.h);
        ctx.fillStyle = '#020d16';
        ctx.fillRect(0, 0, t.w, t.h);
        ctx.imageSmoothingEnabled = true;
        const topLeft = worldToMap(-D.WORLD.HALF, D.WORLD.HALF, t);
        ctx.globalAlpha = 0.92;
        ctx.drawImage(world.mapCanvas, topLeft.x, topLeft.y, D.WORLD.SIZE * t.scale, D.WORLD.SIZE * t.scale);
        ctx.globalAlpha = 1;

        const layers = {
            regions: $('layer-regions').checked,
            pois: $('layer-pois').checked,
            nodes: $('layer-nodes').checked,
            factory: $('layer-factory').checked,
            threats: $('layer-threats').checked,
            relics: $('layer-relics').checked
        };

        // Grille
        ctx.strokeStyle = 'rgba(94,234,212,0.08)'; ctx.lineWidth = 1;
        for (let g = -D.WORLD.HALF; g <= D.WORLD.HALF; g += 400) {
            const a = worldToMap(g, -D.WORLD.HALF, t), b = worldToMap(g, D.WORLD.HALF, t);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            const c = worldToMap(-D.WORLD.HALF, g, t), d = worldToMap(D.WORLD.HALF, g, t);
            ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
        }

        if (layers.regions) {
            D.REGIONS.forEach(reg => {
                if (reg.id === 'rift') return;
                const p = worldToMap(reg.center[0], reg.center[1], t);
                const r = reg.radius * t.scale;
                ctx.strokeStyle = reg.accent + '55';
                ctx.lineWidth = 1;
                ctx.setLineDash([5, 6]);
                ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = 'rgba(224,251,255,.6)';
                ctx.font = '10px Orbitron, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(reg.name.toUpperCase(), p.x, p.y - r - 4);
            });
        }

        if (layers.nodes) {
            (state.discoveredNodes || []).forEach(index => {
                const node = world.nodes[index];
                if (!node || node.stock <= 0) return;
                const p = worldToMap(node.position.x, node.position.z, t);
                ctx.fillStyle = D.RESOURCES[node.resourceType].color;
                ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.7, 2.2 * Math.min(1.8, mapView.zoom)), 0, Math.PI * 2); ctx.fill();
            });
        }

        if (layers.pois) {
            world.pois.forEach(poi => {
                const p = worldToMap(poi.x, poi.z, t);
                const found = !!state.discoveredPois[poi.id];
                ctx.fillStyle = found ? 'rgba(2,14,24,.9)' : 'rgba(2,14,24,.55)';
                ctx.strokeStyle = found ? poi.accent : 'rgba(126,168,182,.45)';
                ctx.lineWidth = found ? 2 : 1;
                ctx.beginPath(); ctx.arc(p.x, p.y, found ? 6 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                if (found) {
                    ctx.fillStyle = '#d7f5fb'; ctx.font = '9px Rajdhani, sans-serif'; ctx.textAlign = 'left';
                    ctx.fillText(poi.short || poi.name, p.x + 9, p.y + 3);
                }
            });
        }

        if (layers.salvage) {
            (world.salvage || []).forEach((cache, index) => {
                if (!cache.revealed && !state.cacheTaken[cache.id]) return;
                const p = worldToMap(cache.position.x, cache.position.z, t);
                ctx.strokeStyle = state.cacheTaken[cache.id] ? 'rgba(126,168,182,.3)' : '#67e8f9';
                ctx.lineWidth = 1.3;
                ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
                if (!state.cacheTaken[cache.id]) {
                    ctx.fillStyle = '#a5f3fc'; ctx.font = '8px Rajdhani, sans-serif'; ctx.textAlign = 'left';
                    ctx.fillText('ÉPAVE', p.x + 7, p.y + 3);
                }
            });
        }

        if (layers.relics) {
            (world.relics || []).forEach(relic => {
                if (!state.relics || !state.relics[relic.id]) return;
                const p = worldToMap(relic.x, relic.z, t);
                ctx.fillStyle = '#d8b4fe';
                ctx.strokeStyle = 'rgba(216,180,254,.85)';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x + 6, p.y); ctx.lineTo(p.x, p.y + 6); ctx.lineTo(p.x - 6, p.y);
                ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#f5d0fe'; ctx.font = '9px Rajdhani, sans-serif'; ctx.textAlign = 'left';
                ctx.fillText(relic.name, p.x + 9, p.y + 3);
            });
        }

        if (layers.factory) {
            ctx.strokeStyle = 'rgba(94,234,212,.55)'; ctx.lineWidth = 1.4;
            state.pipes.forEach(pipe => {
                const from = state.buildings.find(b => b.id === pipe.fromId);
                const to = state.buildings.find(b => b.id === pipe.toId);
                if (!from || !to) return;
                const a = worldToMap(from.position.x, from.position.z, t);
                const b = worldToMap(to.position.x, to.position.z, t);
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            });
            state.buildings.forEach(b => {
                const p = worldToMap(b.position.x, b.position.z, t);
                ctx.fillStyle = b.type === 'hub' ? '#fbbf24' : b.type === 'thermal' || b.type === 'reactor' ? '#34d399' : '#22d3ee';
                const s = b.type === 'hub' ? 5 : 3;
                ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2);
            });
            state.drones.forEach(d => {
                const p = worldToMap(d.mesh.position.x, d.mesh.position.z, t);
                ctx.fillStyle = '#fde047';
                ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2); ctx.fill();
            });
        }

        if (layers.threats) {
            const w = world.weaver;
            if (w) {
                const p = worldToMap(w.group.position.x, w.group.position.z, t);
                ctx.strokeStyle = 'rgba(232,121,249,.55)'; ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 5]);
                ctx.beginPath(); ctx.arc(p.x, p.y, 30 * Math.min(1.8, mapView.zoom), 0, Math.PI * 2); ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = '#e879f9';
                ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#f5d0fe'; ctx.font = '9px Orbitron, sans-serif'; ctx.textAlign = 'left';
                ctx.fillText('TISSERAND', p.x + 9, p.y + 3);
            }
        }

        // Balise
        if (state.waypoint) {
            const p = worldToMap(state.waypoint.x, state.waypoint.z, t);
            ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y - 8); ctx.lineTo(p.x + 6, p.y); ctx.lineTo(p.x, p.y + 8); ctx.lineTo(p.x - 6, p.y); ctx.closePath(); ctx.stroke();
            ctx.fillStyle = 'rgba(250,204,21,.22)'; ctx.fill();
            ctx.fillStyle = '#fde68a'; ctx.font = '9px Orbitron, sans-serif'; ctx.textAlign = 'left';
            ctx.fillText(state.waypoint.label || 'BALISE', p.x + 10, p.y + 3);
        }

        // Marqueurs personnels
        (state.mapMarkers || []).forEach((marker, index) => {
            const mp = worldToMap(marker.x, marker.z, t);
            ctx.strokeStyle = '#fb923c'; ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(mp.x - 5, mp.y - 5); ctx.lineTo(mp.x + 5, mp.y + 5);
            ctx.moveTo(mp.x + 5, mp.y - 5); ctx.lineTo(mp.x - 5, mp.y + 5);
            ctx.stroke();
            ctx.fillStyle = '#fdba74'; ctx.font = '8px Rajdhani, sans-serif'; ctx.textAlign = 'left';
            ctx.fillText(marker.label || `M${index + 1}`, mp.x + 8, mp.y + 3);
        });

        // Joueur
        const p = worldToMap(game.camera.position.x, game.camera.position.z, t);
        const dir = new THREE.Vector3();
        game.camera.getWorldDirection(dir);
        const ang = Math.atan2(dir.x, -dir.z);
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(ang);
        ctx.fillStyle = '#e0fbff';
        ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 7); ctx.lineTo(0, 4); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.strokeStyle = 'rgba(224,251,255,.3)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, Math.PI * 2); ctx.stroke();

        // Cadre & titre
        ctx.strokeStyle = 'rgba(94,234,212,.25)'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, t.w - 1, t.h - 1);
        ctx.fillStyle = 'rgba(2,14,24,.8)';
        ctx.fillRect(10, t.h - 27, 210, 17);
        ctx.fillStyle = 'rgba(94,234,212,.8)'; ctx.font = '9px Share Tech Mono, monospace'; ctx.textAlign = 'left';
        ctx.fillText(`ZOOM ${mapView.zoom.toFixed(2)}× · PROF. MAX ${D.WORLD.MAX_DEPTH} M`, 16, t.h - 15);
    }

    function renderPoiList() {
        const list = $('map-poi-list');
        if (!list) return;
        list.innerHTML = world.pois.map(poi => {
            const found = !!state.discoveredPois[poi.id];
            const dist = Math.round(Math.hypot(poi.x - game.camera.position.x, poi.z - game.camera.position.z));
            return `<button class="poi-item ${found ? 'discovered' : ''}" data-poi="${poi.id}">
                <span class="poi-name"><span style="color:${found ? poi.accent : 'var(--muted)'}">${found ? poi.name : 'Signal non identifié'}</span><span class="micro">${dist} m</span></span>
                <span class="poi-sub">${found ? poi.region.toUpperCase() : 'À EXPLORER'} · ${Math.round(poi.x)}, ${Math.round(poi.z)}</span>
            </button>`;
        }).join('') + (world.relics || []).filter(r => state.relics && state.relics[r.id]).map(relic => {
            const dist = Math.round(Math.hypot(relic.x - game.camera.position.x, relic.z - game.camera.position.z));
            return `<button class="poi-item discovered" data-poi="${relic.id}">
                <span class="poi-name"><span style="color:#d8b4fe">✦ ${relic.name}</span><span class="micro">${dist} m</span></span>
                <span class="poi-sub">ÉCLAT DE MÉMOIRE · ${relic.bonus}</span>
            </button>`;
        }).join('');
        const found = Object.keys(state.discoveredPois || {}).length;
        const relics = Object.keys(state.relics || {}).length;
        $('map-progress').textContent = `${found} / 18 POI · ${relics} / ${D.RELICS.length} ÉCLATS`;
    }

    function renderMapInspector() {
        if (!mapPoiTarget) {
            $('map-inspector-title').textContent = 'Capsule de survie';
            $('map-inspector-meta').textContent = `0 m · ${world.regionAt(0, 0).name}`;
            $('map-inspector-desc').textContent = 'Point d\'ancrage initial et entrepôt central. Sélectionnez un point d\'intérêt ou cliquez sur la carte pour poser une balise.';
            $('map-go-btn').disabled = false;
            if ($('map-travel-btn')) { $('map-travel-btn').disabled = true; $('map-travel-btn').textContent = '⌁ VOYAGE RAPIDE · POINT REQUIS'; }
            return;
        }
        const found = mapPoiTarget.discovered || (mapPoiTarget.id && state.relics && state.relics[mapPoiTarget.id]);
        const travelBtn = $('map-travel-btn');
        if (travelBtn) {
            const canTravel = !!(mapPoiTarget.id && state.discoveredPois[mapPoiTarget.id] && !state.relics[mapPoiTarget.id]);
            travelBtn.disabled = !canTravel;
            travelBtn.textContent = canTravel ? '⌁ VOYAGE RAPIDE · 25 O₂' : '⌁ VOYAGE RAPIDE · POINT REQUIS';
        }
        $('map-inspector-title').textContent = mapPoiTarget.isRelic ? `✦ ${mapPoiTarget.name}` : found ? mapPoiTarget.name : 'Signal non identifié';
        $('map-inspector-meta').textContent = `${Math.round(mapPoiTarget.x)}, ${Math.round(mapPoiTarget.z)} · ${D.REGION_BY_ID[mapPoiTarget.region] ? D.REGION_BY_ID[mapPoiTarget.region].name : ''} · ${world.depthAt(mapPoiTarget.x, mapPoiTarget.z)} m`;
        $('map-inspector-desc').textContent = mapPoiTarget.isRelic
            ? `${mapPoiTarget.desc || 'Un éclat de mémoire précurseur, encore vibrant.'} Bonus permanent : ${mapPoiTarget.bonus}.`
            : found ? mapPoiTarget.desc : 'Un signal non résolu émane de cette position. Approchez-vous pour l\'identifier et enregistrer l\'entrée correspondante dans le codex.';
        $('map-go-btn').disabled = false;
    }

    function selectMapPoi(poi) {
        mapPoiTarget = poi;
        mapView.cx = poi.x;
        mapView.cz = poi.z;
        renderMapInspector();
        drawMap();
        document.querySelectorAll('.poi-item').forEach(el => {
            el.style.borderColor = el.dataset.poi === poi.id ? 'rgba(251,191,36,.6)' : '';
        });
    }

    function setWaypointFromInspector() {
        const x = mapPoiTarget ? mapPoiTarget.x : 0;
        const z = mapPoiTarget ? mapPoiTarget.z : 0;
        const label = mapPoiTarget ? (mapPoiTarget.discovered ? mapPoiTarget.short || mapPoiTarget.name : 'Signal non identifié') : 'Capsule';
        if (game.setWaypoint) game.setWaypoint(x, z, label);
        drawMap();
        toast(`Balise de navigation posée : ${label}.`, 'success', 'NAVIGATION');
    }

    function bindMap() {
        const canvas = $('map-canvas');
        if (!canvas) return;
        canvas.addEventListener('mousedown', e => {
            mapView.dragging = true; mapView.moved = 0;
            mapView.lastX = e.clientX; mapView.lastY = e.clientY;
        });
        window.addEventListener('mousemove', e => {
            if (!mapView.dragging || !isOpen('modal-map')) return;
            const dx = e.clientX - mapView.lastX;
            const dy = e.clientY - mapView.lastY;
            mapView.lastX = e.clientX; mapView.lastY = e.clientY;
            mapView.moved += Math.abs(dx) + Math.abs(dy);
            const t = mapTransform();
            mapView.cx -= dx / t.scale;
            mapView.cz += dy / t.scale;
            drawMap();
        });
        window.addEventListener('mouseup', e => {
            if (!mapView.dragging) return;
            mapView.dragging = false;
            if (mapView.moved > 6 || !isOpen('modal-map') || e.target !== canvas) return;
            const rect = canvas.getBoundingClientRect();
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const t = mapTransform();
            const mx = (e.clientX - rect.left);
            const my = (e.clientY - rect.top);
            const wpt = screenToWorld(mx, my, t);
            const near = world.pois.find(poi => Math.hypot(poi.x - wpt.x, poi.z - wpt.z) < 55);
            if (near) {
                selectMapPoi(near);
            } else {
                mapPoiTarget = {
                    id: null, name: 'Secteur', short: 'Balise', x: Math.round(wpt.x), z: Math.round(wpt.z),
                    region: world.regionAt(wpt.x, wpt.z).id, discovered: true, desc: `Secteur bathymétrique à ${world.depthAt(wpt.x, wpt.z)} m de profondeur.`
                };
                mapView.cx = wpt.x; mapView.cz = wpt.z;
                renderMapInspector();
                drawMap();
            }
        });
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            mapView.zoom = U.clamp(mapView.zoom + (e.deltaY < 0 ? 0.18 : -0.18), 0.7, 4.5);
            drawMap();
        }, { passive: false });
        canvas.addEventListener('mousemove', e => {
            if (!isOpen('modal-map')) return;
            const rect = canvas.getBoundingClientRect();
            const t = mapTransform();
            const wpt = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, t);
            $('map-coords').textContent = `X ${Math.round(wpt.x)} · Z ${Math.round(wpt.z)} · ${world.depthAt(wpt.x, wpt.z)} m`;
        });

        $('map-zoom-in').addEventListener('click', () => { mapView.zoom = Math.min(4.5, mapView.zoom + 0.25); drawMap(); });
        $('map-zoom-out').addEventListener('click', () => { mapView.zoom = Math.max(0.7, mapView.zoom - 0.25); drawMap(); });
        $('map-reset').addEventListener('click', () => {
            mapView.cx = game.camera.position.x; mapView.cz = game.camera.position.z; mapView.zoom = 1.05; drawMap();
        });
        $('map-go-btn').addEventListener('click', setWaypointFromInspector);
        $('map-travel-btn').addEventListener('click', () => {
            if (!mapPoiTarget || !mapPoiTarget.id) return;
            if (game.fastTravel) game.fastTravel(mapPoiTarget.id);
        });
        $('map-marker-btn').addEventListener('click', () => {
            const x = mapPoiTarget ? mapPoiTarget.x : game.camera.position.x;
            const z = mapPoiTarget ? mapPoiTarget.z : game.camera.position.z;
            if (game.addMapMarker) game.addMapMarker(x, z, mapPoiTarget && mapPoiTarget.name ? mapPoiTarget.name : 'Repère');
            renderMapMarkers();
            drawMap();
        });
        $('map-clear-waypoint').addEventListener('click', () => {
            if (game.clearWaypoint) game.clearWaypoint();
            toast('Balise de navigation effacée.', 'info', 'NAVIGATION');
            drawMap();
        });
        $('map-marker-list').addEventListener('click', e => {
            const clear = e.target.closest('#map-marker-clear');
            if (clear) { if (game.clearMapMarkers) game.clearMapMarkers(); renderMapMarkers(); drawMap(); return; }
            const marker = e.target.closest('[data-marker]');
            if (!marker) return;
            const m = (state.mapMarkers || [])[Number(marker.dataset.marker)];
            if (!m) return;
            if (game.setWaypoint) game.setWaypoint(m.x, m.z, m.label);
            toast(`Cap vers ${m.label}.`, 'success', 'NAVIGATION');
            drawMap();
        });
        $('map-poi-list').addEventListener('click', e => {
            const btn = e.target.closest('[data-poi]');
            if (!btn) return;
            const poi = world.pois.find(p => p.id === btn.dataset.poi);
            if (poi) { selectMapPoi(poi); return; }
            const relic = (world.relics || []).find(r => r.id === btn.dataset.poi && state.relics && state.relics[r.id]);
            if (relic) selectMapPoi(Object.assign({}, relic, { isRelic: true, discovered: true }));
        });
        ['layer-regions', 'layer-pois', 'layer-nodes', 'layer-factory', 'layer-threats', 'layer-relics', 'layer-salvage'].forEach(id => {
            const el = $(id);
            if (el) el.addEventListener('change', drawMap);
        });
    }

    /* ------------------------------------------------------------------ */
    /* PARAMÈTRES                                                          */
    /* ------------------------------------------------------------------ */
    function syncSettingsInputs() {
        if (!state) return;
        const s = state.settings;
        const pairs = [
            ['set-master', 'val-master', Math.round(s.master * 100), '%'],
            ['set-music', 'val-music', Math.round(s.music * 100), '%'],
            ['set-ambience', 'val-ambience', Math.round(s.ambience * 100), '%'],
            ['set-sfx', 'val-sfx', Math.round(s.sfx * 100), '%'],
            ['set-sensitivity', 'val-sensitivity', Math.round(s.sensitivity * 100), ''],
            ['set-fov', 'val-fov', Math.round(s.fov), '°']
        ];
        $('set-master').value = Math.round(s.master * 100);
        $('set-music').value = Math.round(s.music * 100);
        $('set-ambience').value = Math.round(s.ambience * 100);
        $('set-sfx').value = Math.round(s.sfx * 100);
        $('set-sensitivity').value = Math.round(s.sensitivity * 100);
        $('set-fov').value = Math.round(s.fov);
        pairs.forEach(([input, label, value, suffix]) => {
            if ($(label)) $(label).textContent = `${value}${suffix}`;
        });
        $('set-quality').value = s.quality;
        $('val-quality').textContent = { low: 'BASSE', medium: 'MOYENNE', high: 'HAUTE', ultra: 'ULTRA' }[s.quality];
        if ($('set-difficulty')) {
            $('set-difficulty').value = state.difficulty || 'engineer';
            $('val-difficulty').textContent = { explorer: 'EXPLORATEUR', engineer: 'INGÉNIEUR', abyssal: 'ABYSSAL' }[state.difficulty || 'engineer'];
        }
        $('set-invert').checked = !!s.invertY;
        $('set-minimap').checked = !!s.minimap;
        $('set-scanlines').checked = !!s.scanlines;
        document.body.classList.toggle('scanlines', !!s.scanlines);
    }

    function bindSettings() {
        const bindRange = (id, key, label, suffix = '%', scale = 100) => {
            const input = $(id);
            if (!input) return;
            input.addEventListener('input', () => {
                const value = parseInt(input.value, 10);
                state.settings[key] = value / scale;
                $(label).textContent = `${value}${suffix}`;
                if (game.applySettings) game.applySettings();
            });
            input.addEventListener('change', () => { if (game.saveSettings) game.saveSettings(); });
        };
        bindRange('set-master', 'master', 'val-master');
        bindRange('set-music', 'music', 'val-music');
        bindRange('set-ambience', 'ambience', 'val-ambience');
        bindRange('set-sfx', 'sfx', 'val-sfx');
        bindRange('set-sensitivity', 'sensitivity', 'val-sensitivity', '', 100);
        bindRange('set-fov', 'fov', 'val-fov', '°', 1);
        const diffSelect = $('set-difficulty');
        if (diffSelect) diffSelect.addEventListener('change', () => {
            if (game.setDifficulty) game.setDifficulty(diffSelect.value);
            $('val-difficulty').textContent = { explorer: 'EXPLORATEUR', engineer: 'INGÉNIEUR', abyssal: 'ABYSSAL' }[diffSelect.value];
        });
        $('set-quality').addEventListener('change', () => {
            state.settings.quality = $('set-quality').value;
            $('val-quality').textContent = { low: 'BASSE', medium: 'MOYENNE', high: 'HAUTE', ultra: 'ULTRA' }[state.settings.quality];
            if (game.changeQuality) game.changeQuality();
            if (game.saveSettings) game.saveSettings();
        });
        $('set-invert').addEventListener('change', () => { state.settings.invertY = $('set-invert').checked; if (game.saveSettings) game.saveSettings(); });
        $('set-minimap').addEventListener('change', () => { state.settings.minimap = $('set-minimap').checked; if (game.saveSettings) game.saveSettings(); });
        $('set-scanlines').addEventListener('change', () => {
            state.settings.scanlines = $('set-scanlines').checked;
            document.body.classList.toggle('scanlines', state.settings.scanlines);
            if (game.saveSettings) game.saveSettings();
        });
        $('btn-settings-reset').addEventListener('click', () => {
            Object.assign(state.settings, JSON.parse(JSON.stringify(D.DEFAULT_SETTINGS)));
            syncSettingsInputs();
            if (game.applySettings) game.applySettings();
            if (game.saveSettings) game.saveSettings();
            toast('Paramètres réinitialisés.', 'info', 'SYSTÈME');
        });
    }

    /* ------------------------------------------------------------------ */
    /* LIAISON DES ÉVÉNEMENTS                                              */
    /* ------------------------------------------------------------------ */
    function bindGlobalEvents() {
        MODALS.forEach(id => {
            const modal = $(id);
            if (!modal) return;
            modal.addEventListener('mousedown', e => {
                if (e.target !== modal) return;
                if (id === 'modal-pause' || id === 'modal-victory') return;
                closeModal(id);
            });
        });
        window.addEventListener('resize', () => {
            if (isOpen('modal-map')) { resizeMap(); drawMap(); }
        });
        // Tab ouvre la console partout, sans Échap ni curseur libéré.
        document.addEventListener('keydown', e => {
            if (e.key !== 'Tab' || e.repeat) return;
            if (isOpen('modal-command')) { e.preventDefault(); e.stopImmediatePropagation(); closeModal('modal-command'); return; }
            if (!anyModalOpen() && state && state.isPlaying) {
                e.preventDefault(); e.stopImmediatePropagation();
                openCommandDeck();
            }
        }, true);
        // Piège à focus : Tab ne doit jamais sortir d'un panneau modal.
        document.addEventListener('keydown', e => {
            if (e.key !== 'Tab' || !anyModalOpen()) return;
            const modal = MODALS.map($).find(el => el && !el.classList.contains('hidden'));
            if (!modal) return;
            const items = focusableIn(modal);
            if (!items.length) return;
            const first = items[0], last = items[items.length - 1];
            const active = document.activeElement;
            if (e.shiftKey && (active === first || !modal.contains(active))) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && (active === last || !modal.contains(active))) {
                e.preventDefault(); first.focus();
            }
        });
    }

    function bindMenu() {
        $('play-btn').addEventListener('click', () => { if (game.start) game.start(); });
        $('reset-btn').addEventListener('click', () => {
            if (window.confirm('Effacer la sauvegarde et recommencer une nouvelle expédition sur Thalassa-IV ?')) {
                if (game.resetGame) game.resetGame();
            }
        });
        $('menu-help-btn').addEventListener('click', openHelp);
        $('close-help').addEventListener('click', () => closeModal('modal-help'));
        $('btn-help-close2').addEventListener('click', () => closeModal('modal-help'));
    }

    function bindHUD() {
        $('btn-map').addEventListener('click', openMap);
        $('btn-map2').addEventListener('click', openMap);
        $('btn-pause').addEventListener('click', () => { if (game.pause) game.pause(); });
        const menuButton = $('btn-menu');
        if (menuButton) menuButton.addEventListener('click', () => { if (game.pause) game.pause(); });
        $('btn-sonar').addEventListener('click', () => { if (game.useSonar) game.useSonar(); });
        $('btn-inventory').addEventListener('click', openInventory);
        $('btn-tech').addEventListener('click', openTech);
        $('btn-catalog').addEventListener('click', openCatalog);
        $('btn-journal').addEventListener('click', openJournal);
        $('btn-codex').addEventListener('click', openCodex);
        $('btn-settings').addEventListener('click', openSettings);
        const quickDeck = $('btn-quick-deck');
        if (quickDeck) quickDeck.addEventListener('click', openCommandDeck);
        const quickActions = {
            'btn-quick-surge': () => game.powerSurge && game.powerSurge(),
            'btn-quick-silence': () => game.silentRunning && game.silentRunning(),
            'btn-quick-ascent': () => game.emergencyAscent && game.emergencyAscent(),
            'btn-quick-autoscan': () => game.toggleAutoScan && game.toggleAutoScan()
        };
        Object.entries(quickActions).forEach(([id, fn]) => { const el = $(id); if (el) el.addEventListener('click', fn); });
        document.querySelectorAll('#hotbar .slot').forEach((slot, index) => {
            slot.addEventListener('click', () => { if (game.selectTool) game.selectTool(index); });
        });
    }

    function bindModals() {
        $('close-command').addEventListener('click', () => closeModal('modal-command'));
        $('modal-command').addEventListener('click', e => {
            const btn = e.target.closest('[data-command]');
            if (btn) executeCommand(btn.dataset.command);
        });
        const commandSearch = $('command-search');
        if (commandSearch) {
            commandSearch.addEventListener('input', filterCommandDeck);
            commandSearch.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    const first = Array.from(document.querySelectorAll('#command-grid .command-btn, #command-quick .command-btn')).find(b => b.style.display !== 'none');
                    if (first) executeCommand(first.dataset.command);
                }
                if (e.key === 'Escape') { e.stopPropagation(); closeModal('modal-command'); }
            });
        }
        $('close-map').addEventListener('click', () => closeModal('modal-map'));
        $('close-tech').addEventListener('click', () => closeModal('modal-tech'));
        $('close-inventory').addEventListener('click', () => closeModal('modal-inventory'));
        $('close-machine').addEventListener('click', () => closeModal('modal-machine'));
        $('close-catalog').addEventListener('click', () => closeModal('modal-catalog'));
        $('close-journal').addEventListener('click', () => closeModal('modal-journal'));
        $('close-codex').addEventListener('click', () => closeModal('modal-codex'));
        $('close-settings').addEventListener('click', () => closeModal('modal-settings'));
        $('close-pause').addEventListener('click', () => { closeModal('modal-pause'); if (game.resume) game.resume(); });
        $('btn-resume').addEventListener('click', () => { closeModal('modal-pause'); if (game.resume) game.resume(); });
        $('btn-pause-save').addEventListener('click', () => {
            const saved = game.saveGame ? game.saveGame(false) : false;
            $('pause-feedback').textContent = saved
                ? '✓ Sauvegarde complète enregistrée localement.'
                : '✕ Sauvegarde impossible : stockage local indisponible ou saturé.';
            if (saved) toast('Sauvegarde enregistrée.', 'success', 'SYSTÈME');
        });
        $('btn-pause-settings').addEventListener('click', () => { settingsReturn = 'modal-pause'; openModal('modal-settings'); });
        $('btn-pause-help').addEventListener('click', () => { settingsReturn = 'modal-pause'; openModal('modal-help'); });
        $('btn-pause-menu').addEventListener('click', () => { if (game.toMenu) game.toMenu(); });
        const pauseBindings = {
            'btn-pause-load': () => game.quickLoad && game.quickLoad(),
            'btn-pause-export': () => game.exportSave && game.exportSave(),
            'btn-pause-photo': () => { closeModal('modal-pause'); if (game.togglePhotoMode) game.togglePhotoMode(); },
            'btn-emergency-o2': () => game.useEmergencyO2 && game.useEmergencyO2(),
            'btn-field-repair': () => game.fieldRepair && game.fieldRepair(),
            'btn-manual-recall': () => game.manualRecall && game.manualRecall(),
            'btn-node-scan': () => game.toggleNodeHighlight && game.toggleNodeHighlight(),
            'btn-surge': () => game.powerSurge && game.powerSurge(),
            'btn-silence': () => game.silentRunning && game.silentRunning(),
            'btn-ascent': () => game.emergencyAscent && game.emergencyAscent(),
            'btn-autoscan': () => game.toggleAutoScan && game.toggleAutoScan(),
            'btn-repeat-build': () => game.repeatLastBuild && game.repeatLastBuild()
        };
        Object.entries(pauseBindings).forEach(([id, fn]) => { const el = $(id); if (el) el.addEventListener('click', fn); });

        const rerollBtn = $('btn-reroll-contracts');
        if (rerollBtn) rerollBtn.addEventListener('click', () => {
            if (game.rerollContracts) game.rerollContracts();
            renderJournal();
        });

        const importBtn = $('btn-pause-import');
        const importInput = $('import-save-file');
        if (importBtn && importInput) {
            importBtn.addEventListener('click', () => importInput.click());
            importInput.addEventListener('change', () => {
                const file = importInput.files && importInput.files[0];
                importInput.value = '';
                if (!file) return;
                if (file.size > 8 * 1024 * 1024) {
                    toast('Fichier trop volumineux : 8 Mo maximum.', 'danger', 'SYSTÈME');
                    return;
                }
                const feedback = $('pause-feedback');
                if (feedback) feedback.textContent = 'Lecture de la sauvegarde…';
                const reader = new FileReader();
                reader.onload = () => {
                    if (game.importSave && game.importSave(String(reader.result || ''))) {
                        if (feedback) feedback.textContent = '✓ Sauvegarde importée. Rechargement…';
                        toast('Sauvegarde importée. Rechargement de l’expédition…', 'success', 'SYSTÈME');
                        setTimeout(() => location.reload(), 700);
                    } else {
                        if (feedback) feedback.textContent = '✕ Import refusé : fichier invalide.';
                        toast('Import refusé : sauvegarde invalide ou incompatible.', 'danger', 'SYSTÈME');
                    }
                };
                reader.onerror = () => {
                    if (feedback) feedback.textContent = '✕ Lecture du fichier impossible.';
                    toast('Lecture du fichier impossible.', 'danger', 'SYSTÈME');
                };
                reader.readAsText(file);
            });
        }

        $('modal-tech').addEventListener('click', e => {
            const btn = e.target.closest('[data-tech]');
            if (!btn) return;
            if (game.buyTech) game.buyTech(btn.dataset.tech);
        });
        $('btn-beacon').addEventListener('click', () => { if (game.activateBeacon) game.activateBeacon(); });

        $('modal-inventory').addEventListener('click', e => {
            const filterBtn = e.target.closest('[data-filter]');
            if (filterBtn) { invFilter = filterBtn.dataset.filter; renderInventory(); return; }
            const cell = e.target.closest('[data-res-key]');
            if (cell) { invSelected = cell.dataset.resKey; renderInventory(); return; }
            const btn = e.target.closest('[data-craft]');
            if (!btn) return;
            if (game.craft) game.craft(btn.dataset.craft, batchCraft ? 5 : 1);
            renderInventory();
        });

        const invSearchInput = $('inv-search');
        if (invSearchInput) {
            invSearchInput.addEventListener('input', () => {
                invSearch = invSearchInput.value.trim().toLowerCase();
                renderInventory();
            });
            invSearchInput.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); } });
        }
        const batchToggle = $('btn-batch-craft');
        if (batchToggle) batchToggle.addEventListener('click', () => { batchCraft = !batchCraft; batchToggle.setAttribute('aria-pressed', String(batchCraft)); renderInventory(); });
        const invGrid = $('inv-grid');
        if (invGrid) {
            invGrid.addEventListener('keydown', e => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                const cell = e.target.closest('[data-res-key]');
                if (!cell) return;
                e.preventDefault();
                invSelected = cell.dataset.resKey;
                renderInventory();
            });
        }
        const marketBtn = $('btn-inv-market');
        if (marketBtn) marketBtn.addEventListener('click', () => openJournal());

        $('modal-machine').addEventListener('click', e => {
            const recipeBtn = e.target.closest('[data-recipe]');
            if (recipeBtn) {
                if (game.setRecipe) game.setRecipe(activeMachine.id, recipeBtn.dataset.recipe);
                renderMachine(game.factory ? game.factory.getById(activeMachine.id) : activeMachine);
                return;
            }
            const actionBtn = e.target.closest('[data-machine-action]');
            if (actionBtn) {
                const action = actionBtn.dataset.machineAction;
                if (action === 'dismantle') {
                    const b = activeMachine;
                    closeModal('modal-machine');
                    if (game.dismantleBuilding) game.dismantleBuilding(b);
                } else if (game.machineAction) {
                    game.machineAction(action, activeMachine);
                    if (isOpen('modal-machine')) renderMachine(game.factory.getById(activeMachine.id));
                }
                return;
            }
        });

        $('modal-catalog').addEventListener('click', e => {
            const btn = e.target.closest('[data-build]');
            if (!btn) return;
            if (game.selectBuildType) game.selectBuildType(btn.dataset.build);
            closeModal('modal-catalog');
        });

        $('modal-journal').addEventListener('click', e => {
            const track = e.target.closest('[data-track-mission]');
            if (track) { if (game.trackMission) game.trackMission(track.dataset.trackMission); return; }
            const buy = e.target.closest('[data-buy]');
            if (buy) { if (game.buyMarket) game.buyMarket(buy.dataset.buy); renderJournal(); return; }
            const sell = e.target.closest('[data-sell]');
            if (sell) { if (game.sellResource) game.sellResource(sell.dataset.sell, Number(sell.dataset.sellQty) || 1); renderJournal(); return; }
            const btn = e.target.closest('[data-contract]');
            if (!btn) return;
            if (game.deliverContract) game.deliverContract(btn.dataset.contract);
            renderJournal();
        });

        $('modal-codex').addEventListener('click', e => {
            const tab = e.target.closest('[data-tab]');
            if (tab) {
                activeCodexCat = tab.dataset.tab;
                activeCodexId = null;
                renderCodex();
                return;
            }
            const item = e.target.closest('[data-codex]');
            if (item) {
                activeCodexId = item.dataset.codex;
                renderCodex();
            }
        });

        $('btn-victory-menu').addEventListener('click', () => { if (game.toMenu) game.toMenu(); });
        $('btn-victory-continue').addEventListener('click', () => { closeModal('modal-victory'); if (game.resumeExploration) game.resumeExploration(); });
    }

    /* ------------------------------------------------------------------ */
    /* EXPORTS                                                             */
    /* ------------------------------------------------------------------ */
    return {
        init, setBoot, hideBoot, showMenu, updateMenu, setPlayLabel, setHUDVisible,
        updateHUD, toast, openMap, openInventory, openTech, openCatalog, openJournal,
        openCommandDeck, executeCommand, renderMarket, renderRecords, renderMapMarkers,
        openCodex, openSettings, openHelp, openPauseModal, closeAllModals, closeModal,
        handleEscape, isOpen, anyModalOpen, getActiveMission, getTrack, rankInfo,
        renderMachine, renderTech, renderJournal, renderCodex, renderInventory, renderCatalog,
        openVictory(stats) {
            const wrap = $('victory-stats');
            if (wrap) {
                wrap.innerHTML = `
                    <div class="v-stat"><b>${Math.round(stats.depth || 0)} m</b><span>PROFONDEUR MAX</span></div>
                    <div class="v-stat"><b>${stats.regions || 0} / 10</b><span>RÉGIONS</span></div>
                    <div class="v-stat"><b>${stats.techs || 0} / ${D.TECHS.length}</b><span>TECHNOLOGIES</span></div>
                    <div class="v-stat"><b>${stats.relics || 0} / ${D.RELICS.length}</b><span>ÉCLATS DE MÉMOIRE</span></div>
                    <div class="v-stat"><b>${U.formatTime(stats.time || 0)}</b><span>IMMERSION</span></div>`;
            }
            openModal('modal-victory');
        },
        setPauseFeedback(text) { if ($('pause-feedback')) $('pause-feedback').textContent = text; },
        setMapSelectedPoi(poi) { selectMapPoi(poi); },
        activeMachine() { return activeMachine; }
    };
})();
