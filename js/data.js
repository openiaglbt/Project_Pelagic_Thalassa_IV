/* ============================================================================
 * PROJECT PELAGIC : THALASSA-IV
 * data.js — Référentiel de conception : monde, économie, technologies, récits.
 * ==========================================================================*/
window.PP = window.PP || {};

PP.Data = (function () {
    'use strict';

    /* ------------------------------------------------------------------ */
    /* CONSTANTES DE MONDE                                                 */
    /* ------------------------------------------------------------------ */
    const WORLD = {
        SIZE: 6400,                 // 6 400 m × 6 400 m = 40,96 km² (4 × l'ancienne carte)
        HALF: 3200,
        SCALE: 2,                   // doublement horizontal de tous les repères existants
        WATER_Y: 16,
        DEPTH_SCALE: 7,             // 1 unité verticale = 7 m de profondeur
        START_Y: 6.5,
        START_DEPTH: 66,
        MAX_DEPTH: 3200,
        SEED: 0x7a41c3d9,
        LAYERS: 10
    };

    const UTILS = {
        clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
        lerp(a, b, t) { return a + (b - a) * t; },
        smoothstep(a, b, x) {
            const t = this.clamp((x - a) / (b - a || 1), 0, 1);
            return t * t * (3 - 2 * t);
        },
        mixColor(a, b, t) {
            const pa = parseInt(a.replace('#', ''), 16);
            const pb = parseInt(b.replace('#', ''), 16);
            const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
            const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
            const r = Math.round(this.lerp(ar, br, t));
            const g = Math.round(this.lerp(ag, bg, t));
            const bl = Math.round(this.lerp(ab, bb, t));
            return `rgb(${r},${g},${bl})`;
        },
        hash2(x, y) {
            let h = Math.sin(x * 127.1 + y * 311.7 + WORLD.SEED * 0.0001) * 43758.5453123;
            return h - Math.floor(h);
        },
        noise2(x, y) {
            const xi = Math.floor(x), yi = Math.floor(y);
            const xf = x - xi, yf = y - yi;
            const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
            const a = this.hash2(xi, yi), b = this.hash2(xi + 1, yi);
            const c = this.hash2(xi, yi + 1), d = this.hash2(xi + 1, yi + 1);
            return this.lerp(this.lerp(a, b, u), this.lerp(c, d, u), v);
        },
        fbm(x, y, octaves = 4, lacunarity = 2.03, gain = 0.5) {
            let amp = 1, freq = 1, sum = 0, norm = 0;
            for (let i = 0; i < octaves; i++) {
                sum += amp * this.noise2(x * freq, y * freq);
                norm += amp;
                amp *= gain;
                freq *= lacunarity;
            }
            return sum / (norm || 1);
        },
        rng(seed) {
            let a = seed >>> 0;
            return function () {
                a |= 0; a = (a + 0x6D2B79F5) | 0;
                let t = Math.imul(a ^ (a >>> 15), 1 | a);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        },
        formatTime(sec) {
            const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
            return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
    };

    /* ------------------------------------------------------------------ */
    /* RESSOURCES                                                          */
    /* ------------------------------------------------------------------ */
    const RESOURCES = {
        titaniumOre:  { name: 'Minerai de titane',    short: 'Ti',    color: '#cbd5e1', tier: 'raw', desc: 'Métal de structure omniprésent dans les sédiments peu profonds.' },
        copperOre:    { name: 'Minerai de cuivre',    short: 'Cu',    color: '#fb923c', tier: 'raw', desc: 'Conducteur natif, indispensable aux cellules et aux câbles.' },
        cryoQuartz:   { name: 'Cryo-quartz',          short: 'Cryo',  color: '#67e8f9', tier: 'raw', desc: 'Cristal piézoélectrique formé sous les eaux glaciales.' },
        magnetite:    { name: 'Magnétite',            short: 'Magn',  color: '#fb7185', tier: 'raw', desc: 'Oxyde ferro-magnétique craché par les cheminées volcaniques.' },
        silica:       { name: 'Silice vitreuse',      short: 'Sil',   color: '#e2e8f0', tier: 'raw', desc: 'Sable aggloméré, base de tout hublot pressurisé.' },
        biofiber:     { name: 'Biofibre',             short: 'Bio',   color: '#86efac', tier: 'raw', desc: 'Fibre souple issue des jardins de kelp et des éponges-siphons.' },
        sulfur:       { name: 'Sulfure hydrothermal', short: 'S',     color: '#fde047', tier: 'raw', desc: 'Dépôt jaune âcre, nécessaire aux réactions exothermiques.' },
        obsidian:     { name: 'Obsidienne',           short: 'Obs',   color: '#a78bfa', tier: 'raw', desc: 'Verre volcanique d\'une dureté extrême, stable sous pression.' },
        uraninite:    { name: 'Uraninite',            short: 'U',     color: '#4ade80', tier: 'raw', desc: 'Minerai radioactif lent, cœur des réactions xéno.' },
        xenoMatter:   { name: 'Matière xéno',         short: 'Xéno',  color: '#e879f9', tier: 'raw', desc: 'Substance organique non terrestre, émettrice de bio-lumière.' },
        titaniumIngot:{ name: 'Lingot de titane',     short: 'L.Ti',  color: '#7dd3fc', tier: 'refined', desc: 'Alliage structural raffiné en fonderie.' },
        copperWire:   { name: 'Fil de cuivre',        short: 'Fil',   color: '#fdba74', tier: 'refined', desc: 'Conducteur tressé pour circuits basse tension.' },
        lithiumCell:  { name: 'Cellule lithium',      short: 'Cell',  color: '#fbbf24', tier: 'refined', desc: 'Accumulateur haute densité pour modules et outils.' },
        glassPane:    { name: 'Hublot composite',     short: 'Hubl',  color: '#bae6fd', tier: 'refined', desc: 'Verre pressurisé à triple lame, certifié 3 000 m.' },
        bioGel:       { name: 'Biogel réparateur',    short: 'Gel',   color: '#4ade80', tier: 'refined', desc: 'Polymère organique qui colmate les microfissures de coque.' },
        magnetCoil:   { name: 'Bobine magnétique',    short: 'Bob',   color: '#34d399', tier: 'refined', desc: 'Induction compacte : moteurs, foreuses, drones.' },
        thermicAlloy: { name: 'Alliage thermique',    short: 'Therm', color: '#fdba74', tier: 'refined', desc: 'Composite réfractaire pour les chaînes de production avancées.' },
        xenoCore:     { name: 'Noyau xéno stabilisé', short: 'Noyau', color: '#facc15', tier: 'refined', desc: 'Matière xéno confinée : source d\'énergie quasi illimitée.' },
        quantumCore:  { name: 'Cœur quantique',       short: 'Q-Core',color: '#c084fc', tier: 'refined', desc: 'Noyau xéno couplé à un biogel : stabilise les champs extrêmes.' }
    };

    const RESOURCE_ORDER = [
        'titaniumOre', 'copperOre', 'cryoQuartz', 'magnetite', 'silica', 'biofiber',
        'sulfur', 'obsidian', 'uraninite', 'xenoMatter', 'titaniumIngot', 'copperWire',
        'lithiumCell', 'glassPane', 'bioGel', 'magnetCoil', 'thermicAlloy', 'xenoCore', 'quantumCore'
    ];

    const START_INVENTORY = {
        titaniumOre: 6, copperOre: 6, cryoQuartz: 0, magnetite: 0, silica: 4,
        biofiber: 4, sulfur: 0, obsidian: 0, uraninite: 0, xenoMatter: 0,
        titaniumIngot: 12, copperWire: 2, lithiumCell: 3, glassPane: 4,
        bioGel: 2, magnetCoil: 3, thermicAlloy: 0, xenoCore: 0, quantumCore: 0
    };

    /* ------------------------------------------------------------------ */
    /* RÉGIONS                                                             */
    /* ------------------------------------------------------------------ */
    const REGIONS = [
        {
            id: 'kelp', index: 1, name: 'Canopée de Kelp', full: 'Canopée de Kelp Lumineux',
            center: [0, 150], radius: 560, height: 5.5, pull: 1.15,
            accent: '#34d399', fog: '#04283c', fogDensity: 0.00155,
            lightTop: '#d8fff4', lightBottom: '#062033', lightIntensity: 1.12,
            depth: [35, 190],
            desc: 'Zone photique. Des forêts de lumen-kelp filtrent la lumière du soleil ; l\'épave Aegir-9 et la serre coloniale y reposent.',
            resources: ['titaniumOre', 'copperOre', 'silica', 'biofiber'],
            fauna: ['lanternfish', 'ribbonManta', 'siphonSponge'],
            ambience: { root: 110, mode: [0, 4, 7, 11], brightness: 0.9, label: 'Forêt photique' }
        },
        {
            id: 'crystal', index: 2, name: 'Plateau Cristallin', full: 'Plateau Cristallin Gelé',
            center: [-780, -180], radius: 470, height: -18, pull: 1.0,
            accent: '#38bdf8', fog: '#062a49', fogDensity: 0.00185,
            lightTop: '#93c5fd', lightBottom: '#08182b', lightIntensity: 0.95,
            depth: [160, 360],
            desc: 'Un plateau de glace minérale où les cristaux chantent sous les courants. Le cryo-quartz y pousse en cathédrales.',
            resources: ['cryoQuartz', 'titaniumOre', 'silica'],
            fauna: ['glassJelly', 'lanternfish'],
            ambience: { root: 98, mode: [0, 3, 7, 10], brightness: 0.75, label: 'Chant de glace' }
        },
        {
            id: 'frozen', index: 3, name: 'Banquise Fossile', full: 'Banquise Fossile',
            center: [-700, 760], radius: 430, height: -24, pull: 0.95,
            accent: '#a5f3fc', fog: '#0a2f3d', fogDensity: 0.0019,
            lightTop: '#a5f3fc', lightBottom: '#08222c', lightIntensity: 0.9,
            depth: [210, 400],
            desc: 'Une plaque de glace ancienne, creusée de galeries et hérissée d\'ossements pris dans le gel. Le froid y ralentit les systèmes.',
            resources: ['cryoQuartz', 'biofiber', 'silica', 'titaniumOre'],
            fauna: ['glassJelly', 'ribbonManta'],
            ambience: { root: 87, mode: [0, 2, 7, 9], brightness: 0.6, label: 'Silence gelé' }
        },
        {
            id: 'metropolis', index: 4, name: 'Métropole Engloutie', full: 'Métropole Engloutie',
            center: [620, 720], radius: 400, height: -30, pull: 1.0,
            accent: '#fbbf24', fog: '#10231f', fogDensity: 0.00205,
            lightTop: '#fcd34d', lightBottom: '#06120f', lightIntensity: 0.8,
            depth: [240, 460],
            desc: 'Les ruines cyclopéennes d\'une civilisation disparue. Ses arches de verre et ses statues de basalte attirent les prédateurs.',
            resources: ['titaniumOre', 'copperOre', 'silica', 'biofiber'],
            fauna: ['ribbonManta', 'lanternfish', 'wardenEel'],
            ambience: { root: 73, mode: [0, 3, 5, 10], brightness: 0.55, label: 'Cité morte' }
        },
        {
            id: 'volcanic', index: 5, name: 'Fumeurs Volcaniques', full: 'Champs de Fumeurs Volcaniques',
            center: [760, -260], radius: 470, height: -54, pull: 1.05,
            accent: '#fb7185', fog: '#2a1009', fogDensity: 0.00245,
            lightTop: '#fdba74', lightBottom: '#1a0803', lightIntensity: 0.65,
            depth: [380, 720],
            desc: 'Une plaine fracturée d\'où s\'échappent des panaches brûlants. La magnétite et le sulfure tapissent les évents.',
            resources: ['magnetite', 'sulfur', 'copperOre'],
            fauna: ['emberEel', 'glassJelly'],
            ambience: { root: 62, mode: [0, 1, 5, 8], brightness: 0.4, label: 'Rugissement tellurique' }
        },
        {
            id: 'hydro', index: 6, name: 'Aiguilles Hydrothermales', full: 'Forêt d\'Aiguilles Hydrothermales',
            center: [1180, -940], radius: 400, height: -78, pull: 1.0,
            accent: '#fb923c', fog: '#231108', fogDensity: 0.0026,
            lightTop: '#fdba74', lightBottom: '#120702', lightIntensity: 0.52,
            depth: [520, 900],
            desc: 'Des tours de pierre noire hautes de cent mètres, coiffées de fumerolles. Le réseau thermique y est deux fois plus productif.',
            resources: ['sulfur', 'magnetite', 'obsidian'],
            fauna: ['emberEel', 'wardenEel'],
            ambience: { root: 55, mode: [0, 1, 4, 7], brightness: 0.32, label: 'Cathédrale de basalte' }
        },
        {
            id: 'graveyard', index: 7, name: 'Cimetière Abyssal', full: 'Le Cimetière Abyssal',
            center: [-380, -820], radius: 540, height: -102, pull: 1.1,
            accent: '#c4b5fd', fog: '#090817', fogDensity: 0.00275,
            lightTop: '#a78bfa', lightBottom: '#04030a', lightIntensity: 0.36,
            depth: [700, 1150],
            desc: 'Des côtes de léviathans gros comme des navires émergent de la vase. Un monolithe précurseur y pulse encore.',
            resources: ['xenoMatter', 'titaniumOre', 'magnetite'],
            fauna: ['boneMoth', 'wardenEel', 'abyssalWeaver'],
            ambience: { root: 49, mode: [0, 1, 3, 8], brightness: 0.22, label: 'Marche des colosses' }
        },
        {
            id: 'labyrinth', index: 8, name: 'Labyrinthe d\'Obsidienne', full: 'Labyrinthe d\'Obsidienne',
            center: [-1240, -620], radius: 390, height: -132, pull: 1.0,
            accent: '#a78bfa', fog: '#0e091d', fogDensity: 0.0029,
            lightTop: '#c4b5fd', lightBottom: '#030208', lightIntensity: 0.3,
            depth: [900, 1350],
            desc: 'Un dédale de parois vitreuses qui renvoient votre sonar comme un rire. L\'obsidienne y pousse en lames.',
            resources: ['obsidian', 'xenoMatter', 'magnetite', 'uraninite'],
            fauna: ['boneMoth', 'voidHunter'],
            ambience: { root: 44, mode: [0, 1, 4, 6], brightness: 0.18, label: 'Écho de verre' }
        },
        {
            id: 'midnight', index: 9, name: 'Fosse de Minuit', full: 'La Fosse de Minuit',
            center: [240, -1250], radius: 450, height: -205, pull: 1.15,
            accent: '#e879f9', fog: '#050309', fogDensity: 0.00315,
            lightTop: '#e879f9', lightBottom: '#020105', lightIntensity: 0.2,
            depth: [1200, 1850],
            desc: 'Une entaille verticale sans fond apparent. La pression y écrase l\'acier ; la matière xéno y prolifère.',
            resources: ['xenoMatter', 'uraninite', 'obsidian'],
            fauna: ['voidHunter', 'abyssalWeaver'],
            ambience: { root: 37, mode: [0, 1, 2, 6], brightness: 0.12, label: 'Battement de Minuit' }
        },
        {
            id: 'maw', index: 10, name: 'La Gueule Xéno', full: 'La Gueule Xéno',
            center: [-140, -1490], radius: 330, height: -295, pull: 1.2,
            accent: '#f0abfc', fog: '#0a0410', fogDensity: 0.0034,
            lightTop: '#f0abfc', lightBottom: '#010002', lightIntensity: 0.14,
            depth: [1900, 2900],
            desc: 'Le terminus de Thalassa-IV. Une structure organique vivante, du taille d\'une ville, respire dans le noir.',
            resources: ['xenoMatter', 'uraninite', 'obsidian'],
            fauna: ['voidHunter', 'abyssalWeaver'],
            ambience: { root: 31, mode: [0, 1, 2, 5], brightness: 0.08, label: 'Respiration du monde' }
        },
        {
            id: 'rift', index: 11, name: 'Faille Périphérique', full: 'La Faille Périphérique',
            center: [0, 0], radius: 900, height: -340, pull: 0.0,
            accent: '#64748b', fog: '#03060b', fogDensity: 0.0036,
            lightTop: '#64748b', lightBottom: '#010102', lightIntensity: 0.1,
            depth: [2200, 3200],
            desc: 'Le rebord du bassin, où la croûte se détache dans le noir. Aucune colonie n\'y a survécu.',
            resources: ['xenoMatter'],
            fauna: ['voidHunter'],
            ambience: { root: 28, mode: [0, 1, 2, 5], brightness: 0.05, label: 'Néant' }
        }
    ];

    const REGION_BY_ID = {};
    REGIONS.forEach(r => { REGION_BY_ID[r.id] = r; });

    /* ------------------------------------------------------------------ */
    /* POINTS D'INTÉRÊT ET MONUMENTS                                       */
    /* ------------------------------------------------------------------ */
    const POIS = [
        { id: 'aegir', name: 'Épave du cargo Aegir-9', short: 'Aegir-9', kind: 'wreck', region: 'kelp', x: -235, z: 235, accent: '#38bdf8', reward: { titaniumOre: 6, copperOre: 4 }, codex: 'poi-aegir', desc: 'La coque brisée du ravitailleur colonial repose en équilibre sur un banc de kelp. Des caisses scellées attendent encore.' },
        { id: 'greenhouse', name: 'Serre coloniale 7', short: 'Serre 7', kind: 'dome', region: 'kelp', x: 265, z: 305, accent: '#4ade80', reward: { biofiber: 6, silica: 4 }, codex: 'poi-greenhouse', desc: 'Un dôme de verre envahi de biofibres. Les cultures ont survécu à l\'abandon ; le système d\'irrigation fonctionne encore.' },
        { id: 'relay', name: 'Relais de surface K-12', short: 'Relais K-12', kind: 'beacon', region: 'kelp', x: 305, z: -420, accent: '#22d3ee', reward: { lithiumCell: 2 }, codex: 'poi-relay', desc: 'Une antenne de communication tombée de l\'orbite. Son émetteur de détresse est encore alimenté par un noyau de secours.' },
        { id: 'frostcave', name: 'Caverne de givre', short: 'Caverne de givre', kind: 'crystal', region: 'crystal', x: -810, z: -145, accent: '#67e8f9', reward: { cryoQuartz: 8 }, codex: 'poi-frostcave', desc: 'Une géode à ciel ouvert. Les cristaux vibrent à une fréquence presque audible et fendent la lumière en arcs.' },
        { id: 'glassarch', name: 'L\'Arche de verre', short: 'Arche de verre', kind: 'arch', region: 'metropolis', x: 565, z: 690, accent: '#fbbf24', reward: { glassPane: 3, titaniumOre: 5 }, codex: 'poi-glassarch', desc: 'Une arche monumentale de verre fondu, seule rescapée d\'un quartier entier. Les glyphes indiquent une date impossible.' },
        { id: 'founder', name: 'Statue du Fondateur', short: 'Le Fondateur', kind: 'statue', region: 'metropolis', x: 790, z: 610, accent: '#f59e0b', reward: { copperOre: 8 }, codex: 'poi-founder', desc: 'Un colosse de basalte à tête de cétacé regarde vers la fosse. Ses mains portent des traces de réparation récentes.' },
        { id: 'caldera', name: 'Caldeira des Fumeurs noirs', short: 'Caldeira', kind: 'caldera', region: 'volcanic', x: 745, z: -300, accent: '#fb7185', reward: { magnetite: 7 }, codex: 'poi-caldera', desc: 'Un anneau de cheminées rugissantes. La chaleur courbe la lumière et les instruments deviennent imprécis.' },
        { id: 'forge', name: 'La Forge naturelle', short: 'Forge naturelle', kind: 'forge', region: 'hydro', x: 1210, z: -915, accent: '#fdba74', reward: { thermicAlloy: 1, sulfur: 5 }, codex: 'poi-forge', desc: 'Une chambre magmatique où le basalte coule en métal liquide. Les précurseurs y ont taillé des marches.' },
        { id: 'leviathan', name: 'Ossuaire du Léviathan', short: 'Ossuaire', kind: 'fossil', region: 'graveyard', x: -410, z: -890, accent: '#c4b5fd', reward: { xenoMatter: 4 }, codex: 'poi-leviathan', desc: 'La cage thoracique d\'un animal de cent quatre-vingts mètres. Des organismes xéno y ont élu domicile.' },
        { id: 'monolith', name: 'Monolithe des Précurseurs', short: 'Monolithe', kind: 'monolith', region: 'graveyard', x: -175, z: -690, accent: '#a855f7', reward: { xenoMatter: 5, uraninite: 2 }, codex: 'poi-monolith', desc: 'Un pilier d\'alliage noir, couvert de glyphes qui s\'allument à votre approche. Le silence autour est anormal.' },
        { id: 'bonegate', name: 'Porte d\'obsidienne', short: 'Porte noire', kind: 'gate', region: 'labyrinth', x: -1270, z: -610, accent: '#a78bfa', reward: { obsidian: 6 }, codex: 'poi-bonegate', desc: 'Deux lames de verre volcanique hautes de soixante mètres. Un passage étroit mène aux galeries interdites.' },
        { id: 'fossilshelf', name: 'Banquise aux fossiles', short: 'Banquise fossile', kind: 'fossil', region: 'frozen', x: -705, z: 780, accent: '#a5f3fc', reward: { cryoQuartz: 5, biofiber: 4 }, codex: 'poi-fossilshelf', desc: 'Des créatures prises dans la glace depuis des millénaires. Les bulles d\'air piégées racontent une atmosphère différente.' },
        { id: 'wraith', name: 'La Nef de Minuit', short: 'Nef de Minuit', kind: 'wreck2', region: 'midnight', x: 300, z: -1290, accent: '#e879f9', reward: { xenoMatter: 6, uraninite: 3 }, codex: 'poi-wraith', desc: 'Un vaisseau sans immatriculation, échoué à la verticale. Ses réacteurs émettent encore un battement régulier.' },
        { id: 'midnightrift', name: 'Faille de Minuit', short: 'Faille de Minuit', kind: 'rift', region: 'midnight', x: 40, z: -1450, accent: '#f0abfc', reward: { xenoMatter: 8 }, codex: 'poi-midnightrift', desc: 'Une déchirure verticale dans le plancher océanique. La pression y atteint des valeurs théoriquement impossibles.' },
        { id: 'mawheart', name: 'Cœur de la Gueule', short: 'Cœur Xéno', kind: 'heart', region: 'maw', x: -150, z: -1510, accent: '#f0abfc', reward: { quantumCore: 1, xenoMatter: 10 }, codex: 'poi-mawheart', desc: 'Une masse organique pulsante, grosse comme une cathédrale. C\'est peut-être un organisme. C\'est peut-être un réacteur.' },
        { id: 'drownedtemple', name: 'Temple submergé', short: 'Temple', kind: 'arch', region: 'metropolis', x: 470, z: 820, accent: '#fcd34d', reward: { glassPane: 2, copperOre: 6 }, codex: 'poi-drownedtemple', desc: 'Un sanctuaire en spirale, intact malgré la pression. L\'eau y est plus chaude de quatre degrés.' },
        { id: 'spires', name: 'Aiguille du Nord', short: 'Aiguille', kind: 'crystal', region: 'hydro', x: 1090, z: -1010, accent: '#fb923c', reward: { sulfur: 6 }, codex: 'poi-spires', desc: 'Une cheminée hydrothermale solitaire, haute de cent dix mètres, visible au sonar à des kilomètres.' },
        { id: 'kelpmother', name: 'La Mère-Kelp', short: 'Mère-Kelp', kind: 'hive', region: 'kelp', x: -95, z: -255, accent: '#34d399', reward: { biofiber: 8, bioGel: 1 }, codex: 'poi-kelpmother', desc: 'Un organisme de kelp unique, âgé de plusieurs siècles, dont les racines abritent un écosystème entier.' }
    ];

    const POI_BY_ID = {};
    POIS.forEach(p => { POI_BY_ID[p.id] = p; });

    /* ------------------------------------------------------------------ */
    /* ÉCLATS DE MÉMOIRE — RELIQUES D'EXPLORATION                          */
    /* ------------------------------------------------------------------ */
    // Chaque éclat est un objet unique, caché dans une région. Il accorde
    // un bonus permanent cumulable et une archive narrative. Le joueur doit
    // s'en approcher et l'extraire : l'exploration a une récompense concrète.
    const RELIC_BUFFS = {
        speed:  { label: 'Dérive assistée',    icon: '≫', desc: 'vitesse de nage' },
        o2:     { label: 'Souffle ancien',     icon: '◌', desc: 'oxygène maximal' },
        hull:   { label: 'Mémoire du basalte', icon: '◈', desc: 'résistance de coque' },
        power:  { label: 'Cœur tellurique',    icon: '⌁', desc: 'rendement énergétique' },
        scan:   { label: 'Écho primitif',      icon: '◎', desc: 'portée sonar et scan' },
        xeno:   { label: 'Symbiose xéno',      icon: '✷', desc: 'matter xéno supplémentaire' },
        stealth: { label: 'Peau de silence',   icon: '≋', desc: 'discrétion face aux prédateurs' },
        light:  { label: 'Lumière hadale',     icon: '☼', desc: 'portée du projecteur' },
        craft:  { label: 'Main de l\'artisan', icon: '⌬', desc: 'vitesse de raffinage' },
        drill:  { label: 'Veine profonde',     icon: '⛏', desc: 'cadence d\'extraction' }
    };

    const RELICS = [
        { id: 'relic-current', codex: 'relic-current', name: 'Éclat du Courant', region: 'kelp', x: -338, z: 58, buff: 'speed', value: 0.08, bonus: '+8 % vitesse', cache: { biofiber: 4, titaniumOre: 6 } },
        { id: 'relic-breath', codex: 'relic-breath', name: 'Éclat du Souffle', region: 'crystal', x: -632, z: -438, buff: 'o2', value: 20, bonus: '+20 s O₂', cache: { cryoQuartz: 5 } },
        { id: 'relic-basalt', codex: 'relic-basalt', name: 'Éclat de Basalte', region: 'frozen', x: -858, z: 706, buff: 'hull', value: 0.12, bonus: '−12 % dégâts', cache: { silica: 5, biofiber: 3 } },
        { id: 'relic-forge', codex: 'relic-forge', name: 'Éclat de la Forge', region: 'volcanic', x: 690, z: -158, buff: 'power', value: 0.10, bonus: '+10 % énergie', cache: { magnetite: 5, sulfur: 4 } },
        { id: 'relic-song', codex: 'relic-song', name: 'Éclat Chantant', region: 'hydro', x: 1084, z: -798, buff: 'scan', value: 0.20, bonus: '+20 % portée scan', cache: { sulfur: 4, obsidian: 2 } },
        { id: 'relic-bone', codex: 'relic-bone', name: 'Éclat d\'Ossement', region: 'graveyard', x: -266, z: -936, buff: 'xeno', value: 1, bonus: '+1 xéno par filon', cache: { xenoMatter: 4 } },
        { id: 'relic-glass', codex: 'relic-glass', name: 'Éclat de Verre', region: 'labyrinth', x: -1136, z: -522, buff: 'stealth', value: 0.25, bonus: '−25 % détection', cache: { obsidian: 4, uraninite: 2 } },
        { id: 'relic-void', codex: 'relic-void', name: 'Éclat du Vide', region: 'midnight', x: 154, z: -1122, buff: 'light', value: 0.45, bonus: '+45 % projecteur', cache: { xenoMatter: 5, uraninite: 2 } },
        { id: 'relic-heart', codex: 'relic-heart', name: 'Éclat de la Gueule', region: 'maw', x: -258, z: -1432, buff: 'o2', value: 15, bonus: '+15 s O₂', cache: { xenoMatter: 6, quantumCore: 1 } },
        { id: 'relic-city', codex: 'relic-city', name: 'Éclat de la Cité', region: 'metropolis', x: 728, z: 784, buff: 'craft', value: 0.12, bonus: '+12 % raffinage', cache: { glassPane: 4, copperOre: 6 } },
        { id: 'relic-tide', codex: 'relic-tide', name: 'Éclat des Marées', region: 'kelp', x: 246, z: 122, buff: 'drill', value: 0.15, bonus: '+15 % forage', cache: { titaniumOre: 5, copperOre: 4 } },
        { id: 'relic-frost', codex: 'relic-frost', name: 'Éclat de Givre', region: 'frozen', x: -524, z: 618, buff: 'hull', value: 0.08, bonus: '−8 % dégâts', cache: { cryoQuartz: 4, glassPane: 2 } }
    ];
    const RELIC_BY_ID = {};
    RELICS.forEach(r => { RELIC_BY_ID[r.id] = r; });

    /* ------------------------------------------------------------------ */
    /* CONTRATS DE LA COLONIE — BOUCLE LONGUE RENOUVELABLE                 */
    /* ------------------------------------------------------------------ */
    const CONTRACT_TEMPLATES = [
        { key: 'titaniumOre', qty: 14, tier: 0, name: 'Commande structurelle', client: 'Atelier de coque', reward: { titaniumIngot: 6, lithiumCell: 2 }, xp: 120 },
        { key: 'copperOre', qty: 12, tier: 0, name: 'Bobinage de secours', client: 'Réseau électrique', reward: { copperWire: 5, bioGel: 1 }, xp: 110 },
        { key: 'silica', qty: 10, tier: 0, name: 'Hublots de remplacement', client: 'Sas colonial', reward: { glassPane: 5, titaniumOre: 4 }, xp: 110 },
        { key: 'biofiber', qty: 10, tier: 0, name: 'Culture de biomasse', client: 'Serre 7', reward: { bioGel: 3, biofiber: 4 }, xp: 130 },
        { key: 'magnetite', qty: 16, tier: 1, name: 'Veines magnétiques', client: 'Fonderie haute-pression', reward: { magnetCoil: 4, thermicAlloy: 1 }, xp: 180 },
        { key: 'cryoQuartz', qty: 10, tier: 1, name: 'Cryo-résonance', client: 'Laboratoire de glace', reward: { lithiumCell: 4, glassPane: 3 }, xp: 190 },
        { key: 'sulfur', qty: 14, tier: 1, name: 'Réactif exothermique', client: 'Forge naturelle', reward: { bioGel: 3, thermicAlloy: 1 }, xp: 200 },
        { key: 'obsidian', qty: 8, tier: 2, name: 'Lames de confinement', client: 'Labyrinthe', reward: { thermicAlloy: 2, quantumCore: 1 }, xp: 280 },
        { key: 'xenoMatter', qty: 7, tier: 2, name: 'Échantillonnage xéno', client: 'Console orbitale', reward: { xenoCore: 1, uraninite: 2, magnetCoil: 3 }, xp: 320 },
        { key: 'uraninite', qty: 8, tier: 2, name: 'Cœur de réaction', client: 'Réacteur xéno', reward: { xenoCore: 1, quantumCore: 1 }, xp: 340 },
        { key: 'titaniumIngot', qty: 8, tier: 2, name: 'Coque hadale', client: 'Chantier Mk.IV', reward: { thermicAlloy: 2, xenoCore: 1 }, xp: 300 },
        { key: 'quantumCore', qty: 1, tier: 3, name: 'Calibration orbitale', client: 'Anneau de secours', reward: { xenoCore: 2, thermicAlloy: 3 }, xp: 420 },
        { key: 'thermicAlloy', qty: 4, tier: 3, name: 'Bouclier thermique', client: 'Fosse de Minuit', reward: { quantumCore: 2, xenoCore: 1 }, xp: 380 }
    ];

    /* ------------------------------------------------------------------ */
    /* FAUNE                                                               */
    /* ------------------------------------------------------------------ */
    const FAUNA = {
        lanternfish:  { name: 'Lanternelle', latin: 'Photichthys thalassae', danger: 0, size: 0.5, desc: 'Banc de petits poissons lumineux. Leur migration éclaire la canopée à la tombée de la nuit.' },
        ribbonManta:  { name: 'Raie-ruban', latin: 'Taeniura pelagica', danger: 0, size: 4.2, desc: 'Plane lentement entre les reliefs, en traînant un ruban bioluminescent de six mètres.' },
        siphonSponge: { name: 'Éponge-siphon', latin: 'Spongia siphonia', danger: 0, size: 1.2, desc: 'Filtreur sessile qui s\'illumine en magenta au passage d\'un plongeur.' },
        glassJelly:   { name: 'Méduse de verre', latin: 'Aurelia vitrea', danger: 1, size: 2.0, desc: 'Fragile en apparence, sa cloche contient une neurotoxine paralysante.' },
        wardenEel:    { name: 'Anguille-garde', latin: 'Anguilla custos', danger: 2, size: 6.5, desc: 'Territoriale, elle patrouille les ruines et charge les sources de bruit.' },
        emberEel:     { name: 'Anguille braise', latin: 'Thermanguilla rubra', danger: 2, size: 5.0, desc: 'Sa peau conduit la chaleur des évents : elle peut faire fondre un hublot.' },
        boneMoth:     { name: 'Papillon d\'os', latin: 'Ossiptera abyssalis', danger: 1, size: 1.5, desc: 'Se nourrit de carbonate de calcium. Ses ailes sont des omoplates translucides.' },
        voidHunter:   { name: 'Chasseur du vide', latin: 'Vacuum venator', danger: 3, size: 12.0, desc: 'prédateur aveugle à latéralité sonar. Il confond les machines avec des proies.' },
        abyssalWeaver: { name: 'Tisserand abyssal', latin: 'Arachnophis bathyalis', danger: 4, size: 28.0, desc: 'Léviathan aranéiforme dont les fils de soie calcifiée peuvent immobiliser un scaphandre.' },
        leviathan:    { name: 'Léviathan pélagique', latin: 'Balaenoptera thalassae', danger: 1, size: 62.0, desc: 'Cétacé colossal qui patrouille la canopée et le plateau. Indifférent au scaphandre, il est le meilleur indicateur de santé de l\'écosystème.' }
    };

    /* ------------------------------------------------------------------ */
    /* RECETTES                                                            */
    /* ------------------------------------------------------------------ */
    const SMELTER_RECIPES = {
        titaniumIngot: { id: 'titaniumIngot', name: 'Lingot de titane',     in: { titaniumOre: 2 },                          out: 'titaniumIngot', time: 2.6, tech: null,          power: 10 },
        copperWire:    { id: 'copperWire',    name: 'Fil de cuivre',        in: { copperOre: 2 },                            out: 'copperWire',    time: 2.2, tech: null,          power: 8 },
        glassPane:     { id: 'glassPane',     name: 'Hublot composite',     in: { silica: 2 },                               out: 'glassPane',     time: 2.4, tech: null,          power: 10 },
        lithiumCell:   { id: 'lithiumCell',   name: 'Cellule lithium',      in: { cryoQuartz: 1, copperOre: 1 },             out: 'lithiumCell',   time: 3.0, tech: null,          power: 12 },
        magnetCoil:    { id: 'magnetCoil',    name: 'Bobine magnétique',    in: { magnetite: 1, titaniumIngot: 1 },          out: 'magnetCoil',    time: 3.2, tech: null,          power: 12 },
        bioGel:        { id: 'bioGel',        name: 'Biogel réparateur',    in: { biofiber: 2, sulfur: 1 },                  out: 'bioGel',        time: 2.8, tech: null,          power: 9 },
        thermicAlloy:  { id: 'thermicAlloy',  name: 'Alliage thermique',    in: { magnetite: 2, obsidian: 1, titaniumIngot: 2 }, out: 'thermicAlloy', time: 5.0, tech: 'metallurgy', power: 16 },
        xenoCore:      { id: 'xenoCore',      name: 'Noyau xéno stabilisé', in: { xenoMatter: 2, magnetCoil: 1, uraninite: 1 }, out: 'xenoCore',  time: 6.0, tech: 'xenoRefining', power: 18 },
        quantumCore:   { id: 'quantumCore',   name: 'Cœur quantique',       in: { xenoCore: 1, glassPane: 1, bioGel: 1 },    out: 'quantumCore',   time: 7.0, tech: 'xenoRefining', power: 18 }
    };

    // Recettes manuelles disponibles depuis le Fabricateur de poche (module [I]).
    const HAND_RECIPES = [
        { id: 'handTitanium', name: 'Lingot de titane',      out: { titaniumIngot: 1 }, cost: { titaniumOre: 2 },                             tech: null },
        { id: 'handWire',     name: 'Fil de cuivre',         out: { copperWire: 1 },    cost: { copperOre: 2 },                               tech: null },
        { id: 'handGlass',    name: 'Hublot composite',      out: { glassPane: 1 },     cost: { silica: 2 },                                  tech: null },
        { id: 'handCell',     name: 'Cellule lithium',       out: { lithiumCell: 1 },   cost: { cryoQuartz: 1, copperOre: 1 },                tech: null },
        { id: 'handGel',      name: 'Biogel réparateur',     out: { bioGel: 1 },        cost: { biofiber: 2, sulfur: 1 },                     tech: null },
        { id: 'handCoil',     name: 'Bobine magnétique',     out: { magnetCoil: 1 },    cost: { magnetite: 1, titaniumIngot: 1 },             tech: null },
        { id: 'handThermic',  name: 'Alliage thermique',     out: { thermicAlloy: 1 },  cost: { magnetite: 2, obsidian: 1, titaniumIngot: 2 },tech: 'metallurgy' },
        { id: 'handXeno',     name: 'Noyau xéno stabilisé',  out: { xenoCore: 1 },      cost: { xenoMatter: 2, magnetCoil: 1, uraninite: 1 }, tech: 'xenoRefining' },
        { id: 'handQuantum',  name: 'Cœur quantique',        out: { quantumCore: 1 },   cost: { xenoCore: 1, glassPane: 1, bioGel: 1 },       tech: 'xenoRefining' }
    ];

    /* ------------------------------------------------------------------ */
    /* BÂTIMENTS                                                           */
    /* ------------------------------------------------------------------ */
    const BUILDINGS = {
        habitat: {
            type: 'habitat', name: 'Module Habitat', slot: 1, power: -5, icon: '⬢',
            cost: { titaniumIngot: 4, glassPane: 2 },
            desc: 'Module pressurisé : recharge l\'O₂, répare la coque et sert de point de ravitaillement.',
            footprint: 5.6, tech: null, category: 'SURVIE'
        },
        drill: {
            type: 'drill', name: 'Foreuse Auto-Thumper', slot: 2, power: -9, icon: '⛏',
            cost: { titaniumIngot: 5, magnetCoil: 2, lithiumCell: 1 },
            desc: 'S\'ancre sur un gisement et extrait du minerai en continu. À relier à une fonderie par convoyeur.',
            footprint: 4.2, tech: null, category: 'EXTRACTION', requiresNode: true, interval: 3.0
        },
        smelter: {
            type: 'smelter', name: 'Fonderie Haute-Pression', slot: 3, power: -11, icon: '♨',
            cost: { titaniumIngot: 6, lithiumCell: 2, glassPane: 1 },
            desc: 'Creuset à induction : transforme les minerais en composants raffinés. Recette configurable.',
            footprint: 5.0, tech: null, category: 'INDUSTRIE'
        },
        thermal: {
            type: 'thermal', name: 'Prise Géothermique', slot: 4, power: 30, icon: '⌁',
            cost: { titaniumIngot: 5, magnetCoil: 2, lithiumCell: 1 },
            desc: 'Produit +30 MW ; +70 MW si posée sur une cheminée hydrothermale. Cœur du réseau électrique.',
            footprint: 4.6, tech: null, category: 'ÉNERGIE'
        },
        scanner: {
            type: 'scanner', name: 'Salle de Scan 360°', slot: 6, power: -16, icon: '◎',
            cost: { titaniumIngot: 8, glassPane: 4, magnetCoil: 2 },
            desc: 'Dôme sonar qui révèle en continu les gisements, les POI et les signatures léviathan sur la carte.',
            footprint: 8.0, tech: 'scanRoom', category: 'SCIENCE'
        },
        droneBay: {
            type: 'droneBay', name: 'Baie de Drones', slot: 7, power: -22, icon: '◈',
            cost: { titaniumIngot: 10, magnetCoil: 5, lithiumCell: 4 },
            desc: 'Déploie un drone cargo autonome qui collecte les filons éloignés et rapporte sa cargaison.',
            footprint: 6.0, tech: 'droneBay', category: 'LOGISTIQUE'
        },
        garden: {
            type: 'garden', name: 'Jardin de Biofibres', slot: null, power: -7, icon: '❧',
            cost: { titaniumIngot: 4, glassPane: 3, bioGel: 2 },
            desc: 'Cultive du kelp synthétique : produit de la biofibre en continu, sans gisement.',
            footprint: 6.5, tech: 'agronomy', category: 'PRODUCTION', interval: 9.0
        },
        storage: {
            type: 'storage', name: 'Entrepôt Pressurisé', slot: null, power: -3, icon: '▤',
            cost: { titaniumIngot: 5, glassPane: 2 },
            desc: 'Tampon logistique de 60 unités. Reliez-le au hub pour vider automatiquement les chaînes.',
            footprint: 6.0, tech: null, category: 'LOGISTIQUE'
        },
        reactor: {
            type: 'reactor', name: 'Réacteur Xéno', slot: null, power: 140, icon: '✷',
            cost: { titaniumIngot: 14, thermicAlloy: 6, xenoCore: 2, glassPane: 4 },
            desc: 'Réacteur à confinement xéno : +140 MW. Nécessite une technologie avancée et des noyaux stabilisés.',
            footprint: 7.5, tech: 'xenoPower', category: 'ÉNERGIE'
        }
    };
    const BUILD_LIST = Object.values(BUILDINGS);
    const BUILD_BY_SLOT = {};
    BUILD_LIST.forEach(b => { if (b.slot !== null) BUILD_BY_SLOT[b.slot] = b; });

    /* ------------------------------------------------------------------ */
    /* TECHNOLOGIES                                                        */
    /* ------------------------------------------------------------------ */
    const TECHS = [
        {
            id: 'o2Mk1', tier: 1, name: 'Recycleur O₂ Mk.I', icon: '◌', requires: [],
            cost: { titaniumIngot: 6, copperWire: 3, bioGel: 1 },
            desc: 'Réservoirs d\'oxygène portés à 160 s et récupération passive accélérée.'
        },
        {
            id: 'sonarBoost', tier: 1, name: 'Amplificateur sonar', icon: '◉', requires: [],
            cost: { titaniumIngot: 5, copperWire: 4, lithiumCell: 2 },
            desc: 'Double la portée du sonar actif et marque durablement les gisements détectés.'
        },
        {
            id: 'scanRoom', tier: 1, name: 'Schéma : Salle de Scan', icon: '◎', requires: ['sonarBoost'],
            cost: { titaniumIngot: 8, glassPane: 4, magnetCoil: 2 },
            desc: 'Débloque la Salle de Scan 360° dans le catalogue de construction.'
        },
        {
            id: 'hullMk2', tier: 1, name: 'Coque renforcée Mk.II', icon: '◈', requires: [],
            cost: { titaniumIngot: 8, lithiumCell: 3, magnetCoil: 2, glassPane: 2 },
            desc: 'Seuil d\'écrasement repoussé à 950 m : accès aux fumeurs volcaniques et aux aiguilles.'
        },
        {
            id: 'acousticPlating', tier: 2, name: 'Placage acoustique', icon: '≋', requires: ['hullMk2'],
            cost: { bioGel: 4, magnetCoil: 3, glassPane: 2 },
            desc: 'Réduit de 60 % la portée de détection du Tisserand abyssal et des prédateurs.'
        },
        {
            id: 'agronomy', tier: 2, name: 'Agronomie abyssale', icon: '❧', requires: ['o2Mk1'],
            cost: { bioGel: 3, titaniumIngot: 4, glassPane: 2 },
            desc: 'Débloque le Jardin de Biofibres : production autonome de biofibre.'
        },
        {
            id: 'metallurgy', tier: 2, name: 'Métallurgie extrême', icon: '⌬', requires: ['hullMk2'],
            cost: { titaniumIngot: 6, magnetCoil: 3, sulfur: 4 },
            desc: 'Débloque l\'alliage thermique, matériau des coques profondes et des réacteurs.'
        },
        {
            id: 'drillMk2', tier: 2, name: 'Foreuse Mk.II', icon: '⛏', requires: ['metallurgy'],
            cost: { titaniumIngot: 8, magnetCoil: 4, thermicAlloy: 2 },
            desc: 'Cycle de forage réduit de 40 % et stockage de sortie doublé.'
        },
        {
            id: 'droneBay', tier: 2, name: 'Schéma : Baie de Drones', icon: '◈', requires: ['scanRoom'],
            cost: { titaniumIngot: 12, magnetCoil: 6, lithiumCell: 4, glassPane: 3 },
            desc: 'Débloque les drones cargo autonomes, capables de travailler hors de vue.'
        },
        {
            id: 'hullMk3', tier: 3, name: 'Coque abyssale Mk.III', icon: '◆', requires: ['hullMk2', 'metallurgy'],
            cost: { titaniumIngot: 14, thermicAlloy: 5, glassPane: 5, magnetCoil: 4 },
            desc: 'Seuil d\'écrasement repoussé à 1 900 m : le Labyrinthe et la Fosse de Minuit s\'ouvrent.'
        },
        {
            id: 'xenoRefining', tier: 3, name: 'Xéno-raffinage', icon: '✷', requires: ['hullMk3', 'droneBay'],
            cost: { xenoMatter: 4, thermicAlloy: 3, magnetCoil: 4, uraninite: 1 },
            desc: 'Débloque les noyaux xéno stabilisés et les cœurs quantiques.'
        },
        {
            id: 'xenoPower', tier: 3, name: 'Confinement xéno', icon: '⚡', requires: ['xenoRefining'],
            cost: { xenoCore: 1, thermicAlloy: 4, glassPane: 4 },
            desc: 'Débloque le Réacteur Xéno (+140 MW) et l\'optimisation des prises géothermiques.'
        },
        {
            id: 'hullMk4', tier: 4, name: 'Coque hadale Mk.IV', icon: '❖', requires: ['hullMk3', 'xenoRefining'],
            cost: { titaniumIngot: 18, thermicAlloy: 8, quantumCore: 2, xenoCore: 1 },
            desc: 'Seuil d\'écrasement repoussé à 3 200 m : la Gueule Xéno et la Faille périphérique.'
        },
        {
            id: 'orbitalProtocol', tier: 4, name: 'Protocole orbital', icon: '⌖', requires: ['hullMk2'],
            cost: { thermicAlloy: 4, xenoCore: 1, quantumCore: 1, glassPane: 4 },
            desc: 'Autorise l\'activation de la balise orbitale depuis la console de recherche. Objectif final.'
        }
    ];
    const TECH_BY_ID = {};
    TECHS.forEach(t => { TECH_BY_ID[t.id] = t; });

    /* ------------------------------------------------------------------ */
    /* MISSIONS                                                            */
    /* ------------------------------------------------------------------ */
    const MAIN_MISSIONS = [
        {
            id: 'm1', name: 'Premier souffle', chapter: 'I',
            desc: 'La capsule est stable, mais l\'oxygène ne durera pas. Construisez un module habitat pour établir un point de ravitaillement.',
            hint: 'Barre d\'outils [2] puis clic gauche sur le sol. Rapprochez-vous de l\'habitat pour recharger l\'O₂.',
            objective: 'Construire 1 module habitat',
            reward: { titaniumIngot: 6, lithiumCell: 2 }, xp: 120,
            track(s) { return { cur: Math.min(1, s.stats.habitats || 0), max: 1 }; }
        },
        {
            id: 'm2', name: 'La chaîne commence', chapter: 'I',
            desc: 'Une colonie sans industrie n\'est qu\'un tombeau. Ancrez une foreuse sur un gisement, installez une fonderie et reliez-les.',
            hint: 'Foreuse [3] sur un filon, fonderie [4] à proximité, puis convoyeur [6] : cliquez la foreuse, puis la fonderie.',
            objective: 'Foreuse + fonderie reliées par convoyeur',
            reward: { magnetCoil: 2, glassPane: 3 }, xp: 180,
            track(s) {
                const linked = s.pipes.length > 0 && s.buildings.some(b => b.type === 'drill') && s.buildings.some(b => b.type === 'smelter');
                const built = (s.buildings.some(b => b.type === 'drill') ? 1 : 0) + (s.buildings.some(b => b.type === 'smelter') ? 1 : 0);
                return { cur: linked ? 3 : built, max: 3 };
            }
        },
        {
            id: 'm3', name: 'Écouter le monde', chapter: 'I',
            desc: 'Le sonar est votre seule carte. Balayez les environs et identifiez les gisements avant de vous enfoncer.',
            hint: '[F] déclenche une impulsion. Les filons marqués restent visibles quelques secondes.',
            objective: 'Utiliser le sonar 3 fois',
            reward: { lithiumCell: 3, copperWire: 3 }, xp: 150,
            track(s) { return { cur: Math.min(3, s.stats.sonarUses || 0), max: 3 }; }
        },
        {
            id: 'm4', name: 'La lisière du cristal', chapter: 'II',
            desc: 'Les relevés indiquent un plateau cristallin à l\'ouest. Descendez sous 250 m pour en confirmer l\'existence.',
            hint: 'Suivez le marqueur de mission sur la carte [M]. Restez sous votre seuil d\'écrasement.',
            objective: 'Atteindre 250 m de profondeur',
            reward: { cryoQuartz: 6, titaniumIngot: 4 }, xp: 220,
            track(s) { return { cur: Math.min(250, Math.round(s.stats.maxDepth || 0)), max: 250 }; }
        },
        {
            id: 'm5', name: 'Le chant des cheminées', chapter: 'II',
            desc: 'Des fumerolles ont été détectées à l\'est. Installez une prise géothermique sur une cheminée pour sécuriser l\'énergie.',
            hint: 'Une fois sur place, posez la prise [5] près d\'une cheminée : le bonus passe à +70 MW.',
            objective: 'Construire une prise sur une cheminée',
            reward: { magnetCoil: 3, thermicAlloy: 1 }, xp: 260,
            track(s) { return { cur: Math.min(1, s.stats.ventThermals || 0), max: 1 }; }
        },
        {
            id: 'm6', name: 'La mémoire des anciens', chapter: 'III',
            desc: 'Un signal répétitif provient du Cimetière abyssal. Trouvez le monolithe des Précurseurs et déchiffrez son message.',
            hint: 'Le monolithe se trouve au sud-ouest, à environ 800 m de profondeur. Explorez les environs.',
            objective: 'Découvrir le Monolithe des Précurseurs',
            reward: { xenoMatter: 4, glassPane: 4 }, xp: 320,
            track(s) { return { cur: s.discoveredPois['monolith'] ? 1 : 0, max: 1 }; }
        },
        {
            id: 'm7', name: 'La Fosse de Minuit', chapter: 'III',
            desc: 'La source du signal est plus bas encore. Atteignez 1 200 m dans la Fosse de Minuit et rapportez un échantillon de matière xéno.',
            hint: 'Une coque Mk.III est indispensable. Récoltez la matière xéno et surveillez le Tisserand.',
            objective: 'Atteindre 1 200 m et récolter 4 matières xéno',
            reward: { xenoMatter: 4, lithiumCell: 4 }, xp: 400,
            track(s) {
                const d = (s.stats.maxDepth || 0) >= 1200 ? 1 : 0;
                const m = Math.min(4, s.stats.xenoMined || 0);
                return { cur: d + m, max: 5 };
            }
        },
        {
            id: 'm8', name: 'Retour vers l\'orbite', chapter: 'IV',
            desc: 'La colonie est autonome. Stabilisez trois noyaux xéno et activez la balise orbitale depuis la console de recherche.',
            hint: 'Noyaux xéno : fonderie avec matière xéno + bobine + uraninite. La console se trouve dans l\'arbre technologique [T].',
            objective: 'Activer la balise orbitale',
            reward: {}, xp: 1000,
            track(s) { return { cur: s.gameWon ? 1 : 0, max: 1 }; }
        }
    ];

    const SIDE_MISSIONS = [
        {
            id: 's1', name: 'Cartographe', desc: 'Visitez six régions distinctes de Thalassa-IV.',
            objective: '6 régions explorées', reward: { lithiumCell: 3, copperWire: 4 }, xp: 200,
            track(s) { return { cur: Object.keys(s.visitedRegions).length, max: 6 }; }
        },
        {
            id: 's2', name: 'Bâtisseur', desc: 'Établissez six bâtiments opérationnels sur le plancher océanique.',
            objective: '6 bâtiments construits', reward: { titaniumIngot: 6, magnetCoil: 2 }, xp: 180,
            track(s) { return { cur: Math.min(6, s.buildings.length - 1), max: 6 }; }
        },
        {
            id: 's3', name: 'Logisticien', desc: 'Reliez trois bâtiments par des convoyeurs pneumatiques.',
            objective: '3 convoyeurs actifs', reward: { magnetCoil: 3, glassPane: 2 }, xp: 220,
            track(s) { return { cur: Math.min(3, s.pipes.length), max: 3 }; }
        },
        {
            id: 's4', name: 'Archéologue', desc: 'Découvrez quatre points d\'intérêt majeurs.',
            objective: '4 POI découverts', reward: { xenoMatter: 2, lithiumCell: 3 }, xp: 260,
            track(s) { return { cur: Math.min(4, Object.keys(s.discoveredPois).length), max: 4 }; }
        },
        {
            id: 's5', name: 'Biologiste', desc: 'Enregistrez cinq espèces dans le codex xéno-biologique.',
            objective: '5 espèces découvertes', reward: { bioGel: 3, glassPane: 2 }, xp: 220,
            track(s) { return { cur: Object.keys(s.codex).filter(k => k.startsWith('fauna-')).length, max: 5 }; }
        },
        {
            id: 's6', name: 'Extraction', desc: 'Extrayez cent unités de minerai brut à la main ou par machine.',
            objective: '100 unités extraites', reward: { titaniumIngot: 5, lithiumCell: 2 }, xp: 240,
            track(s) { return { cur: Math.min(100, Math.floor(s.stats.mined || 0)), max: 100 }; }
        },
        {
            id: 's7', name: 'Automatisation', desc: 'Déployez un drone cargo autonome et laissez-le travailler.',
            objective: '1 drone opérationnel', reward: { magnetCoil: 3, thermicAlloy: 1 }, xp: 280,
            track(s) { return { cur: Math.min(1, s.drones.length), max: 1 }; }
        },
        {
            id: 's8', name: 'Survivant', desc: 'Restez en immersion plus de huit minutes cumulées.',
            objective: '8:00 de temps de jeu', reward: { bioGel: 4, titaniumIngot: 4 }, xp: 300,
            track(s) { return { cur: Math.min(480, Math.floor(s.stats.playTime || 0)), max: 480 }; }
        },
        {
            id: 's9', name: 'Chasseur de colosses', desc: 'Repoussez le Tisserand abyssal deux fois avec le fusil à arc.',
            objective: '2 répulsions', reward: { xenoMatter: 3, thermicAlloy: 1 }, xp: 400,
            track(s) { return { cur: Math.min(2, s.stats.weaverRepels || 0), max: 2 }; }
        },
        {
            id: 's10', name: 'Ingénieur', desc: 'Débloquez dix technologies dans l\'arbre.',
            objective: '10 technologies', reward: { quantumCore: 1, thermicAlloy: 3 }, xp: 500,
            track(s) { return { cur: Object.keys(s.unlockedTechs).length, max: 10 }; }
        },
        {
            id: 's11', name: 'Sans fond', desc: 'Atteignez 2 000 m de profondeur.',
            objective: '2 000 m', reward: { xenoCore: 1, thermicAlloy: 2 }, xp: 700,
            track(s) { return { cur: Math.min(2000, Math.round(s.stats.maxDepth || 0)), max: 2000 }; }
        },
        {
            id: 's12', name: 'Encyclopédiste', desc: 'Renseignez douze entrées du codex.',
            objective: '12 entrées', reward: { quantumCore: 1, xenoMatter: 4 }, xp: 600,
            track(s) { return { cur: Object.keys(s.codex).length, max: 12 }; }
        },
        {
            id: 's13', name: 'Mémoire des abysses', desc: 'Recueillez six éclats de mémoire dissimulés dans les régions.',
            objective: '6 éclats de mémoire', reward: { xenoCore: 1, thermicAlloy: 2 }, xp: 500,
            track(s) { return { cur: Math.min(6, s.stats.relicsFound || 0), max: 6 }; }
        },
        {
            id: 's14', name: 'Contremaître', desc: 'Honorez cinq contrats de la colonie auprès de la capsule.',
            objective: '5 contrats livrés', reward: { quantumCore: 1, magnetCoil: 4 }, xp: 480,
            track(s) { return { cur: Math.min(5, s.stats.contractsDone || 0), max: 5 }; }
        }
    ];

    const ACHIEVEMENTS = [
        { id: 'a1', name: 'Premier contact', desc: 'Extraire votre première ressource.', stat: 'mined', goal: 1 },
        { id: 'a2', name: 'Industriel', desc: 'Construire dix bâtiments.', stat: 'buildCount', goal: 10 },
        { id: 'a3', name: 'Grand voyage', desc: 'Parcourir 5 000 m.', stat: 'distance', goal: 5000 },
        { id: 'a4', name: 'Plongeur', desc: 'Atteindre 500 m.', stat: 'maxDepth', goal: 500 },
        { id: 'a5', name: 'Hadale', desc: 'Atteindre 2 000 m.', stat: 'maxDepth', goal: 2000 },
        { id: 'a6', name: 'Archiviste', desc: 'Découvrir huit POI.', stat: 'poiFound', goal: 8 },
        { id: 'a7', name: 'Xéno-ingenieur', desc: 'Fabriquer un noyau xéno.', stat: 'xenoCoreMade', goal: 1 },
        { id: 'a8', name: 'Survivant des abysses', desc: 'Repousser le Tisserand.', stat: 'weaverRepels', goal: 1 },
        { id: 'a9', name: 'Orbital', desc: 'Activer la balise orbitale.', stat: 'won', goal: 1 },
        { id: 'a10', name: 'Explorateur complet', desc: 'Visiter les dix régions.', stat: 'regionsFound', goal: 10 },
        { id: 'a11', name: 'Mémoire vive', desc: 'Recueillir six éclats de mémoire.', stat: 'relicsFound', goal: 6 },
        { id: 'a12', name: 'Héritier de Thalassa', desc: 'Recueillir les douze éclats de mémoire.', stat: 'relicsFound', goal: 12 },
        { id: 'a13', name: 'Contremaître', desc: 'Livrer cinq contrats de colonie.', stat: 'contractsDone', goal: 5 }
    ];

    /* ------------------------------------------------------------------ */
    /* CODEX                                                               */
    /* ------------------------------------------------------------------ */
    const CODEX = [
        { id: 'region-kelp', cat: 'region', title: 'Canopée de Kelp Lumineux', text: 'La zone photique de Thalassa-IV. Le lumen-kelp y concentre la lumière solaire et abrite la majorité des formes de vie juvéniles. Les courants y sont faibles, la visibilité excellente.' },
        { id: 'region-crystal', cat: 'region', title: 'Plateau Cristallin Gelé', text: 'Une dalle de glace minérale suspendue au-dessus du bassin. Les cristaux de cryo-quartz y atteignent trente mètres et émettent un chant continu à 42 Hz.' },
        { id: 'region-frozen', cat: 'region', title: 'Banquise Fossile', text: 'Vestige d\'une ère glaciaire, cette plaque emprisonne des organismes vieux de plusieurs millions d\'années. Le froid y ralentit les réactions exothermiques.' },
        { id: 'region-metropolis', cat: 'region', title: 'Métropole Engloutie', text: 'Une cité d\'un million d\'habitants, engloutie en moins d\'une heure selon les relevés. Les arches de verre n\'ont pas cédé. Personne n\'a expliqué comment.' },
        { id: 'region-volcanic', cat: 'region', title: 'Champs de Fumeurs Volcaniques', text: 'Le plancher se fracture ici sur quatre kilomètres. Les panaches atteignent 380 °C et déposent de la magnétite en veines concentriques.' },
        { id: 'region-hydro', cat: 'region', title: 'Forêt d\'Aiguilles Hydrothermales', text: 'Des tours de basalte noir, hautes de cent mètres, forment la plus grande centrale naturelle connu de Thalassa-IV. Le rendement géothermique y est doublé.' },
        { id: 'region-graveyard', cat: 'region', title: 'Le Cimetière Abyssal', text: 'Les ossements de léviathans y forment un relief à part entière. Les précurseurs ont construit un monolithe au centre exact, comme pour marquer le territoire.' },
        { id: 'region-labyrinth', cat: 'region', title: 'Labyrinthe d\'Obsidienne', text: 'Un dédale de verre volcanique d\'origine inconnue. Le sonar s\'y réverbère si fort que les relevés deviennent inutilisables au-delà de trente mètres.' },
        { id: 'region-midnight', cat: 'region', title: 'La Fosse de Minuit', text: 'Une crevasse de deux kilomètres de profondeur, mentionnée dans les journaux du Aegir-9. La matière xéno y prolifère et la pression dépasse les limites des alliages standards.' },
        { id: 'region-maw', cat: 'region', title: 'La Gueule Xéno', text: 'Le point le plus profond atteint par l\'expédition. La structure y bat comme un cœur et semble réagir à la présence des noyaux stabilisés.' },
        { id: 'fauna-lanternfish', cat: 'faune', title: 'Lanternelle', text: 'Banc de quatre cents individus synchronisés. Leur photophores s\'allument en vagues qui suivent les courants magnétiques.' },
        { id: 'fauna-ribbonManta', cat: 'faune', title: 'Raie-ruban', text: 'Plane sur six mètres d\'envergure. Son ruban bioluminescent sert de leurre pour attirer des proies planctoniques.' },
        { id: 'fauna-siphonSponge', cat: 'faune', title: 'Éponge-siphon', text: 'Organisme sessile réactif. Son éclat magenta serait un signal de reproduction, déclenché par les vibrations d\'un scaphandre.' },
        { id: 'fauna-glassJelly', cat: 'faune', title: 'Méduse de verre', text: 'Cloche transparente contenant une neurotoxine. Peut paralyser partiellement un scaphandre au contact prolongé.' },
        { id: 'fauna-wardenEel', cat: 'faune', title: 'Anguille-garde', text: 'Prédateur territorial des ruines. Réagit aux champs électriques et poursuit toute source de bruit persistante.' },
        { id: 'fauna-emberEel', cat: 'faune', title: 'Anguille braise', text: 'Sa peau conduit la chaleur des évents et peut faire fondre un hublot de classe II. Éviter le contact.' },
        { id: 'fauna-boneMoth', cat: 'faune', title: 'Papillon d\'os', text: 'Se nourrit de carbonate de calcium et niche dans les côtes de léviathans. Ses ailes sont des omoplates translucides.' },
        { id: 'fauna-voidHunter', cat: 'faune', title: 'Chasseur du vide', text: 'Prédateur aveugle, il chasse au sonar. Les machines vibrent plus fort que les créatures : un drone est une proie idéale.' },
        { id: 'fauna-abyssalWeaver', cat: 'faune', title: 'Tisserand abyssal', text: 'Léviathan aranéiforme de vingt-huit mètres. Il tisse des bio-câbles capables d\'immobiliser un scaphandre. Le fusil à arc le repousse.' },
        { id: 'fauna-leviathan', cat: 'faune', title: 'Léviathan pélagique', text: 'Soixante-deux mètres de longueur, une silhouette qui traverse la canopée en silence. Ses photophores latéraux dessinent une carte des courants froids. Aucune agression documentée.' },
        { id: 'poi-aegir', cat: 'structure', title: 'Épave du Aegir-9', text: 'Ravitailleur colonial, porté disparu treize ans avant votre arrivée. Sa coque porte des marques de morsure à vingt mètres du sol.' },
        { id: 'poi-greenhouse', cat: 'structure', title: 'Serre coloniale 7', text: 'Une serre autonome qui fonctionne encore. Les cultures ont muté sous la pression et produisent une biomasse exploitable.' },
        { id: 'poi-relay', cat: 'structure', title: 'Relais K-12', text: 'Antenne de communication tombée de l\'orbite. Son émetteur est encore alimenté par une cellule de secours.' },
        { id: 'poi-frostcave', cat: 'structure', title: 'Caverne de givre', text: 'Une géode naturelle où le cristal se forme à une vitesse anormale. Les précurseurs y ont laissé une marque gravée.' },
        { id: 'poi-glassarch', cat: 'structure', title: 'L\'Arche de verre', text: 'Monument public d\'une cité disparue. Les glyphes de sa base mentionnent une date postérieure à l\'extinction.' },
        { id: 'poi-founder', cat: 'structure', title: 'Statue du Fondateur', text: 'Représentation d\'un dirigeant à tête de cétacé. Les réparations récentes sur ses mains n\'ont pas été faites par des humains.' },
        { id: 'poi-caldera', cat: 'structure', title: 'Caldeira des Fumeurs noirs', text: 'Anneau de sept cheminées actives. La température y dépasse 380 °C ; les instruments deviennent erratiques.' },
        { id: 'poi-forge', cat: 'structure', title: 'La Forge naturelle', text: 'Chambre magmatique où le basalte se comporte comme un métal. Des marches taillées descendent dans le bain.' },
        { id: 'poi-leviathan', cat: 'structure', title: 'Ossuaire du Léviathan', text: 'Cage thoracique d\'un animal de cent-quatre-vingts mètres. Des organismes xéno y ont élu domicile.' },
        { id: 'poi-monolith', cat: 'structure', title: 'Monolithe des Précurseurs', text: 'Pilier d\'alliage noir couvert de glyphes. Il s\'allume à votre approche et émet une séquence de coordonnées.' },
        { id: 'poi-bonegate', cat: 'structure', title: 'Porte d\'obsidienne', text: 'Deux lames de verre volcanique hautes de soixante mètres. Le passage mène aux galeries interdites du Labyrinthe.' },
        { id: 'poi-fossilshelf', cat: 'structure', title: 'Banquise aux fossiles', text: 'Créatures prises dans la glace, dont une espèce non répertoriée. Les bulles d\'air piégées ont une composition différente de l\'eau actuelle.' },
        { id: 'poi-wraith', cat: 'structure', title: 'La Nef de Minuit', text: 'Vaisseau sans immatriculation, échoué à la verticale. Ses réacteurs battent encore, alimentés par un noyau xéno.' },
        { id: 'poi-midnightrift', cat: 'structure', title: 'Faille de Minuit', text: 'Déchirure verticale dans le plancher océanique. La pression y atteint des valeurs théoriquement impossibles pour cette profondeur.' },
        { id: 'poi-mawheart', cat: 'structure', title: 'Cœur de la Gueule', text: 'Masse organique pulsante de la taille d\'une cathédrale. Elle réagit à la proximité des noyaux stabilisés.' },
        { id: 'poi-kelpmother', cat: 'structure', title: 'La Mère-Kelp', text: 'Organisme de kelp âgé de plusieurs siècles. Ses racines abritent un écosystème entier de filtreurs et de larves.' },
        { id: 'poi-drownedtemple', cat: 'structure', title: 'Temple Englouti', text: 'Sanctuaire circulaire dont la voûte a résisté à l\'effondrement. Les glyphes du sol forment une carte partielle du bassin, incomplète vers le nord.' },
        { id: 'poi-spires', cat: 'structure', title: 'Aiguille du Nord', text: 'Cheminée hydrothermale solitaire de cent dix mètres, visible au sonar à des kilomètres. Sa base abrite une faune aveugle unique.' },
        { id: 'relic-current', cat: 'relique', title: 'Éclat du Courant', text: 'Un fragment de verre bleu parcouru de veines lumineuses. Il vibre au rythme des courants et semble alléger le scaphandre. Les précurseurs l\'ont peut-être oublié ici volontairement.' },
        { id: 'relic-breath', cat: 'relique', title: 'Éclat du Souffle', text: 'Une bulle de cristal qui ne remonte jamais. À son contact, les réservoirs d\'oxygène se stabilisent et la respiration devient plus lente, plus profonde.' },
        { id: 'relic-basalt', cat: 'relique', title: 'Éclat de Basalte', text: 'Pierre noire fendue par une chaleur ancienne. Sa surface absorbe les chocs et renvoie un écho grave, comme si la coque se souvenait d\'avoir été plus épaisse.' },
        { id: 'relic-forge', cat: 'relique', title: 'Éclat de la Forge', text: 'Un noyau de magnétite vitrifié. Il continue de produire un courant faible, des siècles après sa création. Les instruments du réseau le reconnaissent comme un module légitime.' },
        { id: 'relic-song', cat: 'relique', title: 'Éclat Chantant', text: 'Cristal piézoélectrique qui émet à 42 Hz. Il amplifie les impulsions sonar et dessine dans l\'eau des lignes que le relief ne justifie pas.' },
        { id: 'relic-bone', cat: 'relique', title: 'Éclat d\'Ossement', text: 'Fragment d\'os minéralisé, chaud au toucher. La matière xéno alentour se densifie à son approche : les filons livrent davantage de substance vivante.' },
        { id: 'relic-glass', cat: 'relique', title: 'Éclat de Verre', text: 'Lame d\'obsidienne parfaitement polie. Elle dévie les ondes de détection et rend le scaphandre presque silencieux pour les prédateurs.' },
        { id: 'relic-void', cat: 'relique', title: 'Éclat du Vide', text: 'Une sphère noire qui avale la lumière et la restitue plus loin. Montée dans le projecteur, elle repousse l\'obscurité hadale de plusieurs dizaines de mètres.' },
        { id: 'relic-heart', cat: 'relique', title: 'Éclat de la Gueule', text: 'Masse organique tiède, battant à un rythme irrégulier. Elle ne provient d\'aucune créature connue et semble respirer à travers le scaphandre.' },
        { id: 'relic-city', cat: 'relique', title: 'Éclat de la Cité', text: 'Éclat de verre fondu prisonnier d\'un glyphe. Les outils de raffinage s\'alignent sur sa fréquence et travaillent plus vite, comme guidés par une main invisible.' },
        { id: 'relic-tide', cat: 'relique', title: 'Éclat des Marées', text: 'Coquille spiralée incrustée de titane. Elle transmet aux foreuses une cadence oubliée, plus ancienne que la colonie elle-même.' },
        { id: 'relic-frost', cat: 'relique', title: 'Éclat de Givre', text: 'Glace minérale qui ne fond pas. Sa structure absorbe les contraintes et renforce localement la coque, comme un second squelette.' },
        { id: 'phenomenon-sonar', cat: 'phenomene', title: 'Échos de Thalassa', text: 'Le sonar rebondit différemment selon la densité xéno de l\'eau. Certains échos ne correspondent à aucun relief connu.' },
        { id: 'phenomenon-current', cat: 'phenomene', title: 'Courants de convection', text: 'Les courants chauds remontent des fosses et déplacent les particules en spirale. Ils peuvent porter un scaphandre sur des centaines de mètres.' },
        { id: 'phenomenon-biolum', cat: 'phenomene', title: 'Efflorescence bioluminescente', text: 'À certaines périodes, le plancton s\'illumine en masse. Le phénomène dure environ quatre-vingt-dix secondes et révèle des chemins invisibles.' },
        { id: 'phenomenon-xeno', cat: 'phenomene', title: 'Résonance xéno', text: 'La matière xéno émet une fréquence de 12 Hz qui perturbe les instruments. Les précurseurs l\'utilisaient comme balise.' },
        { id: 'phenomenon-pressure', cat: 'phenomene', title: 'Mur de pression hadale', text: 'Passé 1 900 m, l\'eau cesse de se comporter comme un fluide ordinaire. Les bulles remontent en sifflant et la coque chante sous la contrainte.' },
        { id: 'phenomenon-thermal', cat: 'phenomene', title: 'Panache hydrothermal', text: 'Colonne d\'eau à 340 °C, maintenue liquide par la pression. Les prises géothermiques y doublent leur rendement, au prix d\'une corrosion féroce.' },
        { id: 'phenomenon-beacon', cat: 'phenomene', title: 'Protocole orbital', text: 'La capsule peut ouvrir un canal vers l\'anneau orbital si trois noyaux xéno stabilisés alimentent la balise. C\'est la seule voie de retour.' }
    ];
    const CODEX_BY_ID = {};
    CODEX.forEach(c => { CODEX_BY_ID[c.id] = c; });
    const CODEX_CATS = {
        region: 'Régions', faune: 'Faune', structure: 'Structures', relique: 'Éclats de mémoire', phenomene: 'Phénomènes'
    };

    /* ------------------------------------------------------------------ */
    /* PARAMÈTRES                                                          */
    /* ------------------------------------------------------------------ */
    const DEFAULT_SETTINGS = {
        master: 0.8, music: 0.55, ambience: 0.65, sfx: 0.75,
        quality: 'high', sensitivity: 1.0, fov: 72, invertY: false,
        minimap: true, scanlines: true, hudScale: 1.0
    };

    const QUALITY_PRESETS = {
        low:    { pixelRatio: 1.0, shadows: false, flora: 0.45, particles: 0.4, fog: 1.25, viewDistance: 900,  lod: 0.6,  bloom: false },
        medium: { pixelRatio: 1.25, shadows: false, flora: 0.7,  particles: 0.7, fog: 1.05, viewDistance: 1400, lod: 0.8,  bloom: false },
        high:   { pixelRatio: 1.6, shadows: true,  flora: 1.0,  particles: 1.0, fog: 1.0,  viewDistance: 2000, lod: 1.0,  bloom: true },
        ultra:  { pixelRatio: 2.0, shadows: true,  flora: 1.35, particles: 1.4, fog: 0.92, viewDistance: 2600, lod: 1.25, bloom: true }
    };

    const XENO_CORE_REQUIRED = 3;
    const BEACON_EXTRA_COST = { titaniumIngot: 6, magnetCoil: 4, quantumCore: 1 };

    /* ------------------------------------------------------------------ */
    /* DOUBLEMENT DE LA CARTE                                             */
    /* Tous les repères de conception sont exprimés dans l'ancien repère   */
    /* 3 200 m, puis dilatés une seule fois ici. Les identifiants, les     */
    /* régions et les relations logiques restent inchangés.                */
    if (WORLD.SCALE !== 1) {
        const s = WORLD.SCALE;
        REGIONS.forEach(reg => {
            if (reg.id === 'rift') return;
            reg.center = [reg.center[0] * s, reg.center[1] * s];
            reg.radius *= s;
        });
        POIS.forEach(poi => { poi.x *= s; poi.z *= s; });
        RELICS.forEach(relic => { relic.x *= s; relic.z *= s; });
    }

    return {
        WORLD, UTILS, RESOURCES, RESOURCE_ORDER, START_INVENTORY,
        REGIONS, REGION_BY_ID, POIS, POI_BY_ID, FAUNA,
        SMELTER_RECIPES, HAND_RECIPES, BUILDINGS, BUILD_LIST, BUILD_BY_SLOT,
        TECHS, TECH_BY_ID, MAIN_MISSIONS, SIDE_MISSIONS, ACHIEVEMENTS,
        CODEX, CODEX_BY_ID, CODEX_CATS, DEFAULT_SETTINGS, QUALITY_PRESETS,
        RELICS, RELIC_BY_ID, RELIC_BUFFS, CONTRACT_TEMPLATES,
        XENO_CORE_REQUIRED, BEACON_EXTRA_COST
    };
})();
