/* ============================================================================
 * audio.js — Synthèse audio procédurale (musique adaptative, ambiances, SFX)
 * Aucun asset externe : tout est généré par la Web Audio API.
 * ==========================================================================*/
window.PP = window.PP || {};

PP.Audio = (function () {
    'use strict';

    class Engine {
        constructor() {
            this.ctx = null;
            this.ready = false;
            this.failed = false;
            this.master = null;
            this.musicBus = null;
            this.ambienceBus = null;
            this.sfxBus = null;
            this.delay = null;
            this.noiseBuffer = null;
            this.ambienceSource = null;
            this.ambienceFilter = null;
            this.ambienceGain = null;
            this.rumble = null;
            this.rumbleGain = null;
            this.heartTimer = 0;
            this.musicTimer = 0;
            this.melodyTimer = 0;
            this.ambienceEventTimer = 2;
            this.region = null;
            this.root = 110;
            this.mode = [0, 3, 7, 10];
            this.danger = 0;
            this.muted = false;
            this.chordIndex = 0;
        }

        init() {
            if (this.ready || this.failed) return this.ready;
            try {
                const Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx) throw new Error('Web Audio non supporté');
                this.ctx = new Ctx();
                const ctx = this.ctx;

                this.master = ctx.createGain();
                this.master.gain.value = 0.8;
                this.master.connect(ctx.destination);

                this.musicBus = ctx.createGain();
                this.musicBus.gain.value = 0.5;
                this.musicBus.connect(this.master);

                this.ambienceBus = ctx.createGain();
                this.ambienceBus.gain.value = 0.6;
                this.ambienceBus.connect(this.master);

                this.sfxBus = ctx.createGain();
                this.sfxBus.gain.value = 0.7;
                this.sfxBus.connect(this.master);

                // Espace : delay filtré avec rétroaction (simule la réverbération de l'eau)
                this.delay = ctx.createDelay(1.4);
                this.delay.delayTime.value = 0.31;
                const feedback = ctx.createGain();
                feedback.gain.value = 0.32;
                const wet = ctx.createGain();
                wet.gain.value = 0.28;
                const delayFilter = ctx.createBiquadFilter();
                delayFilter.type = 'lowpass';
                delayFilter.frequency.value = 1800;
                this.delay.connect(delayFilter);
                delayFilter.connect(feedback);
                feedback.connect(this.delay);
                delayFilter.connect(wet);
                wet.connect(this.master);

                this.noiseBuffer = this.createNoise(3.0);

                // Nappe de bruit océanique
                this.ambienceSource = ctx.createBufferSource();
                this.ambienceSource.buffer = this.noiseBuffer;
                this.ambienceSource.loop = true;
                this.ambienceFilter = ctx.createBiquadFilter();
                this.ambienceFilter.type = 'lowpass';
                this.ambienceFilter.frequency.value = 380;
                this.ambienceFilter.Q.value = 0.6;
                this.ambienceGain = ctx.createGain();
                this.ambienceGain.gain.value = 0.055;
                this.ambienceSource.connect(this.ambienceFilter);
                this.ambienceFilter.connect(this.ambienceGain);
                this.ambienceGain.connect(this.ambienceBus);
                this.ambienceSource.start();

                // Grondement tellurique
                this.rumble = ctx.createOscillator();
                this.rumble.type = 'sine';
                this.rumble.frequency.value = 42;
                this.rumbleGain = ctx.createGain();
                this.rumbleGain.gain.value = 0.022;
                this.rumble.connect(this.rumbleGain);
                this.rumbleGain.connect(this.ambienceBus);
                this.rumble.start();

                this.ready = true;
                if (ctx.state === 'suspended') ctx.resume().catch(() => {});
                return true;
            } catch (error) {
                console.warn('[Audio] initialisation impossible :', error);
                this.failed = true;
                return false;
            }
        }

        createNoise(seconds) {
            const ctx = this.ctx;
            const length = Math.floor(ctx.sampleRate * seconds);
            const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            let last = 0;
            for (let i = 0; i < length; i++) {
                const white = Math.random() * 2 - 1;
                last = (last + 0.02 * white) / 1.02;
                data[i] = last * 3.2 + white * 0.16;
            }
            return buffer;
        }

        resume() {
            if (!this.ctx) return;
            if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        }

        setVolume(master, music, ambience, sfx) {
            if (!this.ready) return;
            const m = PP.Data.UTILS.clamp(master, 0, 1);
            this.master.gain.setTargetAtTime(m, this.ctx.currentTime, 0.05);
            this.musicBus.gain.setTargetAtTime(PP.Data.UTILS.clamp(music, 0, 1) * 0.55, this.ctx.currentTime, 0.05);
            this.ambienceBus.gain.setTargetAtTime(PP.Data.UTILS.clamp(ambience, 0, 1) * 0.7, this.ctx.currentTime, 0.05);
            this.sfxBus.gain.setTargetAtTime(PP.Data.UTILS.clamp(sfx, 0, 1) * 0.85, this.ctx.currentTime, 0.05);
        }

        setRegion(region) {
            if (!region || !this.ready) return;
            if (this.region === region.id) return;
            this.region = region.id;
            this.root = region.ambience.root;
            this.mode = region.ambience.mode;
            const depthFactor = PP.Data.UTILS.clamp(1 - (region.index - 1) / 12, 0.25, 1);
            this.ambienceFilter.frequency.setTargetAtTime(180 + depthFactor * 520, this.ctx.currentTime, 1.2);
            this.rumble.frequency.setTargetAtTime(30 + depthFactor * 28, this.ctx.currentTime, 1.4);
            // Une note de transition discrète
            this.pad(this.root * 0.5, 0.12, 6.5, 0.03);
        }

        setDanger(value) {
            this.danger = PP.Data.UTILS.clamp(value, 0, 1);
        }

        noteFreq(semitone) {
            return this.root * Math.pow(2, semitone / 12);
        }

        /* ---------------------------------------------------------------- */
        /* MUSIQUE                                                          */
        /* ---------------------------------------------------------------- */
        pad(freq, duration, attack, volume, type = 'sine') {
            if (!this.ready) return;
            const ctx = this.ctx;
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const gain = ctx.createGain();
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 520;
            filter.Q.value = 2.6;
            osc.type = type;
            osc2.type = 'triangle';
            osc.frequency.value = freq;
            osc2.frequency.value = freq * 1.006;
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + attack);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
            osc.connect(filter);
            osc2.connect(filter);
            filter.connect(gain);
            gain.connect(this.musicBus);
            gain.connect(this.delay);
            osc.start(now);
            osc2.start(now);
            osc.stop(now + duration + 0.1);
            osc2.stop(now + duration + 0.1);
        }

        playChord() {
            if (!this.ready) return;
            const modes = [[0, 4, 7, 11], [0, 3, 7, 10], [0, 5, 7, 12], [0, 2, 7, 9]];
            const shape = modes[this.chordIndex % modes.length];
            this.chordIndex++;
            shape.forEach((semi, index) => {
                const degrees = this.mode;
                const semitone = degrees[index % degrees.length] + semi;
                this.pad(this.noteFreq(semitone), 9.5 + Math.random() * 3, 2.4 + index * 0.35, 0.035 - index * 0.004);
            });
            if (this.danger > 0.45) {
                this.pad(this.root * 0.5, 4.5, 0.5, 0.026, 'sawtooth');
            }
        }

        pluck() {
            if (!this.ready) return;
            const ctx = this.ctx;
            const now = ctx.currentTime;
            const degree = this.mode[Math.floor(Math.random() * this.mode.length)];
            const octave = Math.random() < 0.4 ? 2 : 1;
            const freq = this.noteFreq(degree) * octave * (Math.random() < 0.3 ? 2 : 1);
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(0.035, now + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
            osc.connect(gain);
            gain.connect(this.musicBus);
            gain.connect(this.delay);
            osc.start(now);
            osc.stop(now + 2.3);
        }

        /* ---------------------------------------------------------------- */
        /* SFX                                                              */
        /* ---------------------------------------------------------------- */
        tone({ freq = 440, endFreq = null, type = 'sine', duration = 0.2, volume = 0.12, attack = 0.005, bus = null }) {
            if (!this.ready) return;
            const ctx = this.ctx;
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(Math.max(20, freq), now);
            if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + attack);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
            osc.connect(gain);
            gain.connect(bus || this.sfxBus);
            osc.start(now);
            osc.stop(now + duration + 0.05);
        }

        noiseBurst(duration = 0.25, volume = 0.12, cutoff = 900, type = 'lowpass') {
            if (!this.ready) return;
            const ctx = this.ctx;
            const now = ctx.currentTime;
            const src = ctx.createBufferSource();
            src.buffer = this.noiseBuffer;
            src.loop = true;
            const filter = ctx.createBiquadFilter();
            filter.type = type;
            filter.frequency.setValueAtTime(cutoff, now);
            filter.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.25), now + duration);
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(volume, now);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
            src.connect(filter);
            filter.connect(gain);
            gain.connect(this.sfxBus);
            src.start(now);
            src.stop(now + duration + 0.05);
        }

        sonar() {
            this.tone({ freq: 1180, endFreq: 620, type: 'sine', duration: 1.7, volume: 0.16 });
            setTimeout(() => this.tone({ freq: 1180, endFreq: 620, type: 'sine', duration: 1.2, volume: 0.055 }), 380);
            this.noiseBurst(1.1, 0.028, 1500, 'bandpass');
        }

        mine() { this.noiseBurst(0.12, 0.075, 1600, 'bandpass'); this.tone({ freq: 340, endFreq: 120, type: 'sawtooth', duration: 0.14, volume: 0.055 }); }
        cut() { this.tone({ freq: 460, endFreq: 120, type: 'sawtooth', duration: 0.16, volume: 0.08 }); }
        build() {
            this.tone({ freq: 180, endFreq: 420, type: 'triangle', duration: 0.22, volume: 0.13 });
            setTimeout(() => this.tone({ freq: 620, endFreq: 980, type: 'sine', duration: 0.3, volume: 0.1 }), 90);
        }
        craft() {
            this.tone({ freq: 520, endFreq: 780, type: 'triangle', duration: 0.16, volume: 0.1 });
            setTimeout(() => this.tone({ freq: 880, endFreq: 1200, type: 'sine', duration: 0.2, volume: 0.08 }), 120);
        }
        pickup() { this.tone({ freq: 780, endFreq: 1180, type: 'sine', duration: 0.12, volume: 0.075 }); }
        relic() {
            [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => setTimeout(() => this.tone({ freq: f, endFreq: f * 1.005, type: 'sine', duration: 1.4, volume: 0.07, bus: this.musicBus }), i * 120));
            this.pad(261.63, 5, 0.35, 0.05);
        }
        contract() {
            this.tone({ freq: 392, endFreq: 523.25, type: 'triangle', duration: 0.28, volume: 0.08 });
            setTimeout(() => this.tone({ freq: 659.25, endFreq: 783.99, type: 'sine', duration: 0.5, volume: 0.07 }), 140);
        }
        error() { this.tone({ freq: 150, endFreq: 90, type: 'sawtooth', duration: 0.24, volume: 0.11 }); }
        click() { this.tone({ freq: 620, endFreq: 520, type: 'sine', duration: 0.06, volume: 0.045 }); }
        open() { this.tone({ freq: 320, endFreq: 640, type: 'triangle', duration: 0.18, volume: 0.06 }); }
        close() { this.tone({ freq: 560, endFreq: 280, type: 'triangle', duration: 0.16, volume: 0.05 }); }
        arc() {
            this.tone({ freq: 880, endFreq: 140, type: 'sawtooth', duration: 0.26, volume: 0.16 });
            this.tone({ freq: 1420, endFreq: 340, type: 'square', duration: 0.16, volume: 0.07 });
            this.noiseBurst(0.2, 0.05, 2600, 'highpass');
        }
        weaver() {
            this.tone({ freq: 310, endFreq: 85, type: 'sawtooth', duration: 0.8, volume: 0.18 });
            this.tone({ freq: 740, endFreq: 220, type: 'sine', duration: 0.6, volume: 0.09 });
            this.noiseBurst(0.7, 0.045, 400, 'lowpass');
        }
        heartbeat() {
            this.tone({ freq: 58, endFreq: 34, type: 'sine', duration: 0.24, volume: 0.2 });
            setTimeout(() => this.tone({ freq: 50, endFreq: 30, type: 'sine', duration: 0.28, volume: 0.15 }), 240);
            this.noiseBurst(0.28, 0.018, 180);
        }
        alarm() {
            this.tone({ freq: 720, endFreq: 520, type: 'square', duration: 0.18, volume: 0.07 });
            setTimeout(() => this.tone({ freq: 720, endFreq: 520, type: 'square', duration: 0.18, volume: 0.07 }), 260);
        }
        victory() {
            [523, 659, 784, 1046].forEach((f, i) => {
                setTimeout(() => this.tone({ freq: f, endFreq: f * 1.01, type: 'sine', duration: 1.1, volume: 0.1 }), i * 170);
            });
            setTimeout(() => this.pad(261, 7, 0.4, 0.06), 200);
        }
        levelUp() {
            [440, 587, 880].forEach((f, i) => setTimeout(() => this.tone({ freq: f, type: 'triangle', duration: 0.28, volume: 0.09 }), i * 90));
        }
        bubble() {
            const f = 500 + Math.random() * 700;
            this.tone({ freq: f, endFreq: f * 2.2, type: 'sine', duration: 0.09 + Math.random() * 0.08, volume: 0.025 });
        }
        hull() {
            this.tone({ freq: 92, endFreq: 58, type: 'sawtooth', duration: 1.1, volume: 0.09 });
            this.noiseBurst(0.6, 0.035, 220);
        }
        drone() {
            this.tone({ freq: 210, endFreq: 340, type: 'triangle', duration: 0.34, volume: 0.06 });
        }
        scan() {
            this.tone({ freq: 660, endFreq: 1320, type: 'sine', duration: 0.5, volume: 0.06 });
            setTimeout(() => this.tone({ freq: 880, endFreq: 1480, type: 'sine', duration: 0.4, volume: 0.05 }), 140);
        }
        gate() {
            this.tone({ freq: 70, endFreq: 180, type: 'sawtooth', duration: 2.4, volume: 0.12 });
            this.noiseBurst(1.6, 0.05, 420);
        }

        /* ---------------------------------------------------------------- */
        /* MISE À JOUR TEMPS RÉEL                                           */
        /* ---------------------------------------------------------------- */
        update(dt) {
            if (!this.ready || !this.ctx || this.ctx.state === 'closed') return;

            this.musicTimer -= dt;
            if (this.musicTimer <= 0) {
                this.musicTimer = 15 + Math.random() * 7;
                this.playChord();
            }
            this.melodyTimer -= dt;
            if (this.melodyTimer <= 0) {
                this.melodyTimer = 2.2 + Math.random() * 5.5;
                this.pluck();
            }
            this.ambienceEventTimer -= dt;
            if (this.ambienceEventTimer <= 0) {
                this.ambienceEventTimer = 3 + Math.random() * 7;
                if (Math.random() < 0.55) {
                    const f = 60 + Math.random() * 90;
                    this.tone({ freq: f, endFreq: f * 0.7, type: 'sine', duration: 2.4, volume: 0.035, bus: this.ambienceBus });
                } else {
                    this.noiseBurst(0.9, 0.012, 240 + Math.random() * 300);
                }
            }
            if (this.danger > 0.15) {
                this.heartTimer -= dt * (0.55 + this.danger);
                if (this.heartTimer <= 0) {
                    this.heartTimer = 1.6 - this.danger * 0.6;
                    this.heartbeat();
                }
            }
        }
    }

    const engine = new Engine();

    return {
        init: () => engine.init(),
        resume: () => engine.resume(),
        setVolume: (...a) => engine.setVolume(...a),
        setRegion: (r) => engine.setRegion(r),
        setDanger: (d) => engine.setDanger(d),
        update: (dt) => engine.update(dt),
        sonar: () => engine.sonar(),
        mine: () => engine.mine(),
        cut: () => engine.cut(),
        build: () => engine.build(),
        craft: () => engine.craft(),
        pickup: () => engine.pickup(),
        relic: () => engine.relic(),
        contract: () => engine.contract(),
        error: () => engine.error(),
        click: () => engine.click(),
        open: () => engine.open(),
        close: () => engine.close(),
        arc: () => engine.arc(),
        weaver: () => engine.weaver(),
        heartbeat: () => engine.heartbeat(),
        alarm: () => engine.alarm(),
        victory: () => engine.victory(),
        levelUp: () => engine.levelUp(),
        bubble: () => engine.bubble(),
        hull: () => engine.hull(),
        drone: () => engine.drone(),
        scan: () => engine.scan(),
        gate: () => engine.gate(),
        get ready() { return engine.ready; },
        get ctx() { return engine.ctx; },
        get danger() { return engine.danger; }
    };
})();
