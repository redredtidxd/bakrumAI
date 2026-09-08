/* ==========================================================================
       1. TEXTURAS PROCEDURALES CANVAS 2D
       ========================================================================== */
    // RNG de texturas con semilla FIJA: el papel pintado y el techo se generan
    // identicos en cada partida y en cada cliente (antes usaban Math.random y
    // la misma semilla "1" daba texturas distintas cada vez que se abria el
    // juego, como si el backroom cambiase de partida a partida).
    function mulberry32Tex(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0;
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    const texRng = mulberry32Tex(0x9E3779B9);

    const TextureGenerator = {
        createWallpaperTexture() {
            const canvas = document.createElement('canvas');
            canvas.width = 512; canvas.height = 512;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = '#b39d48';
            ctx.fillRect(0, 0, 512, 512);

            ctx.fillStyle = '#a38c3e';
            for (let x = 0; x < 512; x += 16) {
                ctx.fillRect(x + 6, 0, 3, 512);
            }

            const imgData = ctx.getImageData(0, 0, 512, 512);
            const d = imgData.data;
            for (let i = 0; i < d.length; i += 4) {
                const noise = (texRng() - 0.5) * 18;
                d[i] = Math.min(255, Math.max(0, d[i] + noise));
                d[i+1] = Math.min(255, Math.max(0, d[i+1] + noise));
                d[i+2] = Math.min(255, Math.max(0, d[i+2] + noise * 0.6));
            }
            ctx.putImageData(imgData, 0, 0);

            ctx.fillStyle = '#5c5442';
            ctx.fillRect(0, 0, 512, 22);
            ctx.fillStyle = '#363024';
            ctx.fillRect(0, 20, 512, 4);

            ctx.fillStyle = '#2c1f14';
            ctx.fillRect(0, 470, 512, 4);
            ctx.fillStyle = '#1a120a';
            ctx.fillRect(0, 474, 512, 38);

            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            return tex;
        },

        createCeilingTexture() {
            // Falso techo de losetas acusticas (cada loseta = 128 px = 1,4 m):
            // borde biselado (luz arriba/izquierda, sombra abajo/derecha),
            // rehundido central y poros de pladur. Antes era una losa plana
            // con una cruz y parecia un pladur lavado, no un techo de
            // backrooms.
            const canvas = document.createElement('canvas');
            canvas.width = 512; canvas.height = 512;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = '#757262';
            ctx.fillRect(0, 0, 512, 512);
            const rng = mulberry32Tex(0xC0FFEE);
            for (let ty = 0; ty < 4; ty++) {
                for (let tx = 0; tx < 4; tx++) {
                    const x0 = tx * 128, y0 = ty * 128;
                    // Bisel: borde superior/izquierdo claro, inferior/derecho oscuro
                    ctx.fillStyle = '#8b887a';
                    ctx.fillRect(x0, y0, 128, 3);
                    ctx.fillRect(x0, y0, 3, 128);
                    ctx.fillStyle = '#5d5a4e';
                    ctx.fillRect(x0, y0 + 125, 128, 3);
                    ctx.fillRect(x0 + 125, y0, 3, 128);
                    // Rehundido central
                    ctx.fillStyle = '#6e6b5d';
                    ctx.fillRect(x0 + 4, y0 + 4, 120, 120);
                    // Poros / granulacion del pladur
                    for (let i = 0; i < 48; i++) {
                        const px = x0 + 8 + rng() * 112;
                        const py = y0 + 8 + rng() * 112;
                        ctx.fillStyle = rng() < 0.5 ? 'rgba(20,18,10,0.10)' : 'rgba(255,255,255,0.05)';
                        ctx.fillRect(px, py, 2, 2);
                    }
                }
            }
            // Rejilla de la junta entre losetas
            ctx.strokeStyle = '#454238';
            ctx.lineWidth = 2;
            for (let i = 0; i <= 4; i++) {
                ctx.beginPath(); ctx.moveTo(i * 128, 0); ctx.lineTo(i * 128, 512); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, i * 128); ctx.lineTo(512, i * 128); ctx.stroke();
            }

            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            return tex;
        },

        createWoodTexture() {
            // Veta de madera clara/oscura para mesas y muebles de oficina.
            // RNG fijo: todos los clientes ven la misma veta.
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = '#4a3521';
            ctx.fillRect(0, 0, 256, 256);
            ctx.strokeStyle = 'rgba(26, 17, 9, 0.55)';
            for (let i = 0; i < 46; i++) {
                ctx.lineWidth = 1 + texRng() * 2.6;
                ctx.beginPath();
                const y = texRng() * 256;
                let x = -10;
                ctx.moveTo(x, y);
                while (x < 266) {
                    x += 22 + texRng() * 42;
                    ctx.lineTo(x, y + (texRng() - 0.5) * 26);
                }
                ctx.stroke();
            }
            for (let i = 0; i < 4; i++) {
                ctx.fillStyle = 'rgba(18, 11, 5, 0.4)';
                const kx = texRng() * 256, ky = texRng() * 256;
                ctx.beginPath();
                ctx.ellipse(kx, ky, 3 + texRng() * 5, 2 + texRng() * 3.5, texRng() * 3, 0, Math.PI * 2);
                ctx.fill();
            }

            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            return tex;
        },

        createChalkBoxTexture() {
            const canvas = document.createElement('canvas');
            canvas.width = 256; canvas.height = 256;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = '#7a6234';
            ctx.fillRect(0, 0, 256, 256);
            ctx.strokeStyle = '#241a0a';
            ctx.lineWidth = 5;
            ctx.strokeRect(6, 6, 244, 244);
            ctx.fillStyle = '#54150f';
            ctx.fillRect(14, 18, 228, 55);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 18px Courier New';
            ctx.textAlign = 'center';
            ctx.fillText("NO. 12 DUSTLESS", 128, 44);
            ctx.font = 'bold 13px Courier New';
            ctx.fillText("CHALK STICKS", 128, 64);
            ctx.fillStyle = '#171717';
            ctx.font = '12px Courier New';
            ctx.fillText("SCHOOL QUALITY", 128, 130);
            ctx.fillText("VINTAGE FORMULA", 128, 160);

            return new THREE.CanvasTexture(canvas);
        },

        createChalkDotTexture() {
            const canvas = document.createElement('canvas');
            canvas.width = 32; canvas.height = 32;
            const ctx = canvas.getContext('2d');
            const rad = ctx.createRadialGradient(16, 16, 2, 16, 16, 16);
            rad.addColorStop(0, 'rgba(255, 255, 255, 1)');
            rad.addColorStop(0.5, 'rgba(255, 255, 255, 0.7)');
            rad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = rad;
            ctx.fillRect(0, 0, 32, 32);
            return new THREE.CanvasTexture(canvas);
        }
    };

    /* ==========================================================================
       SUELO CON TEXTURA EXTERNA (assets/floor-texture.png)
       La imagen viaja embebida en base64 (js/textures-data.js) para que el juego
       funcione tambien abriendo index.html directamente desde el disco (file://).
       Mientras el PNG se decodifica se usa un pixel de color medio como respaldo
       (asi el suelo nunca se ve negro en el primer frame).
       ========================================================================== */
    const FloorCarpetTexture = new THREE.Texture();
    FloorCarpetTexture.wrapS = THREE.RepeatWrapping;
    FloorCarpetTexture.wrapT = THREE.RepeatWrapping;
    {
        const ph = document.createElement('canvas');
        ph.width = 1;
        ph.height = 1;
        const pctx = ph.getContext('2d');
        pctx.fillStyle = '#8c874a';
        pctx.fillRect(0, 0, 1, 1);
        FloorCarpetTexture.image = ph;
        FloorCarpetTexture.needsUpdate = true;
    }
    const floorCarpetImg = new Image();
    floorCarpetImg.onload = () => {
        FloorCarpetTexture.image = floorCarpetImg;
        FloorCarpetTexture.needsUpdate = true;
    };
    floorCarpetImg.src = FLOOR_TEXTURE_DATA_URL;
