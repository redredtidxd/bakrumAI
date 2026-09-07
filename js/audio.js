/* ==========================================================================
       2. SINTETIZADOR DE AUDIO PROCEDURAL (WEB AUDIO API)
       ========================================================================== */
    class AudioEngine {
        constructor() {
            this.ctx = null;
            this.masterGain = null;
            this.humGain = null;
            this.initialized = false;
        }

        init() {
            if (this.initialized) return;
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioCtx();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.7;
            this.masterGain.connect(this.ctx.destination);

            this.startHum();
            this.initialized = true;
        }

        setMasterVolume(val) {
            if (this.masterGain) this.masterGain.gain.setValueAtTime(val, this.ctx.currentTime);
        }

        startHum() {
            const osc1 = this.ctx.createOscillator();
            const osc2 = this.ctx.createOscillator();
            const filter = this.ctx.createBiquadFilter();
            this.humGain = this.ctx.createGain();

            osc1.type = 'sawtooth';
            osc1.frequency.value = 60;
            osc2.type = 'sine';
            osc2.frequency.value = 120;
            filter.type = 'lowpass';
            filter.frequency.value = 220;

            this.humGain.gain.value = 0.04;

            osc1.connect(filter);
            osc2.connect(filter);
            filter.connect(this.humGain);
            this.humGain.connect(this.masterGain);

            osc1.start();
            osc2.start();
        }

        flickerHum() {
            if (!this.humGain) return;
            const t = this.ctx.currentTime;
            this.humGain.gain.setValueAtTime(0.005, t);
            this.humGain.gain.linearRampToValueAtTime(0.07, t + 0.03);
            this.humGain.gain.linearRampToValueAtTime(0.04, t + 0.08);
        }

        playSwitchClick() {
            if (!this.ctx) return;
            const t = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(900, t);
            osc.frequency.exponentialRampToValueAtTime(140, t + 0.03);

            gain.gain.setValueAtTime(0.35, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);

            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(t);
            osc.stop(t + 0.04);
        }

        playFootstep() {
            if (!this.ctx) return;
            const t = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const filter = this.ctx.createBiquadFilter();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(90, t);
            osc.frequency.exponentialRampToValueAtTime(22, t + 0.12);
            filter.type = 'lowpass';
            filter.frequency.value = 200;

            gain.gain.setValueAtTime(0.18, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);
            osc.start(t);
            osc.stop(t + 0.14);
        }

        playFurnitureThud() {
            if (!this.ctx) return;
            const t = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(80, t);
            osc.frequency.exponentialRampToValueAtTime(28, t + 0.18);
            gain.gain.setValueAtTime(0.32, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(t);
            osc.stop(t + 0.24);
        }

        playChalkScratch() {
            if (!this.ctx) return;
            const t = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(1100 + Math.random() * 500, t);
            osc.frequency.linearRampToValueAtTime(700, t + 0.04);

            gain.gain.setValueAtTime(0.04, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(t);
            osc.stop(t + 0.06);
        }

        playCameraFlash() {
            if (!this.ctx) return;
            const t = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(2800, t);
            osc.frequency.exponentialRampToValueAtTime(110, t + 0.4);

            gain.gain.setValueAtTime(0.35, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);

            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(t);
            osc.stop(t + 0.43);
        }

        playDrink() {
            if (!this.ctx) return;
            const t = this.ctx.currentTime;
            for (let i = 0; i < 3; i++) {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.frequency.setValueAtTime(280 - i * 35, t + i * 0.14);
                osc.frequency.exponentialRampToValueAtTime(120, t + i * 0.14 + 0.1);
                gain.gain.setValueAtTime(0.14, t + i * 0.14);
                gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.14 + 0.11);
                osc.connect(gain);
                gain.connect(this.masterGain);
                osc.start(t + i * 0.14);
                osc.stop(t + i * 0.14 + 0.12);
            }
        }

        playMonsterRoar() {
            if (!this.ctx) return;
            const t = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const filter = this.ctx.createBiquadFilter();

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(65, t);
            osc.frequency.linearRampToValueAtTime(150, t + 0.35);
            osc.frequency.exponentialRampToValueAtTime(20, t + 1.2);
            filter.type = 'bandpass';
            filter.frequency.value = 260;
            filter.Q.value = 5;

            gain.gain.setValueAtTime(0.55, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 1.25);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);
            osc.start(t);
            osc.stop(t + 1.3);
        }

        playJumpscare() {
            if (!this.ctx) return;
            const t = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(750, t);
            osc.frequency.linearRampToValueAtTime(60, t + 0.9);

            gain.gain.setValueAtTime(0.8, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.95);

            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(t);
            osc.stop(t + 1.0);
        }
    }

    const audio = new AudioEngine();
