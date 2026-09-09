/* ==========================================================================
       9. MODELO DEL EXPLORADOR (jugadores remotos del multijugador)
       ==========================================================================
       Humanoides procedimentales con primitivas: pantalon oscuro, torso con
       el color del jugador (para distinguirlos en la sala), cabeza con cara,
       mochila y una linterna en la mano derecha. Devuelve { group, headY,
       limbs } para que el HUD de nombres, el foco de luz y la ANIMACION DE
       CAMINAR (net.js) se enganchen a las partes correctas.
       ========================================================================== */
    function createExplorerModel(colorHex) {
        const jacket = new THREE.Color(colorHex || 0x9a8b4f);

        const darkMat = new THREE.MeshStandardMaterial({ color: 0x2e2e38, roughness: 0.85 });
        const clothMat = new THREE.MeshStandardMaterial({
            color: jacket,
            roughness: 0.85,
            emissive: jacket,
            emissiveIntensity: 0.08
        });
        const skinMat = new THREE.MeshStandardMaterial({ color: 0xc99a73, roughness: 0.7 });
        const hairMat = new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.9 });
        const metalMat = new THREE.MeshStandardMaterial({ color: 0x55555e, metalness: 0.6, roughness: 0.4 });
        const lensMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
        const bootMat = new THREE.MeshStandardMaterial({ color: 0x1c1a16, roughness: 0.9 });

        const group = new THREE.Group();

        // ---- Piernas con bota (grupos pivote en la cadera para animar) ----
        const legGeo = new THREE.CylinderGeometry(0.06, 0.055, 0.55, 8);
        const bootGeo = new THREE.BoxGeometry(0.09, 0.09, 0.18);
        const mkLeg = (x) => {
            const pivot = new THREE.Group();
            pivot.position.set(x, 0.62, 0);
            const leg = new THREE.Mesh(legGeo, darkMat);
            leg.position.y = -0.27;
            pivot.add(leg);
            const boot = new THREE.Mesh(bootGeo, bootMat);
            boot.position.set(0, -0.53, 0.03);
            pivot.add(boot);
            group.add(pivot);
            return pivot;
        };
        const legL = mkLeg(-0.1);
        const legR = mkLeg(0.1);

        // ---- Torso (cazadora del color del jugador) con hombros ----
        const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.14, 0.52, 10), clothMat);
        torso.position.y = 0.88;
        group.add(torso);
        // Hombros: la cazadora no es un tubo liso
        const shoulderGeo = new THREE.SphereGeometry(0.085, 8, 6);
        const shL = new THREE.Mesh(shoulderGeo, clothMat);
        shL.position.set(-0.185, 1.06, 0);
        const shR = new THREE.Mesh(shoulderGeo, clothMat);
        shR.position.set(0.185, 1.06, 0);
        group.add(shL, shR);
        // Cremallera oscura delantera
        const zip = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.4, 0.02), darkMat);
        zip.position.set(0, 0.88, 0.165);
        group.add(zip);

        // ---- Brazos con mano (pivotes en el hombro para animar) ----
        const armGeo = new THREE.CylinderGeometry(0.045, 0.04, 0.5, 8);
        const handGeo = new THREE.SphereGeometry(0.045, 7, 5);
        const mkArm = (x, tilt) => {
            const pivot = new THREE.Group();
            pivot.position.set(x, 1.08, 0);
            const arm = new THREE.Mesh(armGeo, clothMat);
            arm.position.y = -0.25;
            arm.rotation.x = 0.12;
            pivot.add(arm);
            const hand = new THREE.Mesh(handGeo, skinMat);
            hand.position.y = -0.52;
            pivot.add(hand);
            pivot.rotation.z = tilt;
            group.add(pivot);
            return pivot;
        };
        const armL = mkArm(-0.21, 0.1);
        const armR = mkArm(0.21, -0.1);

        // ---- Cabeza con cuello y cara ----
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.07, 8), skinMat);
        neck.position.y = 1.25;
        group.add(neck);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 10), skinMat);
        head.position.y = 1.4;
        group.add(head);
        // Pelo (media melena corta)
        const hair = new THREE.Mesh(new THREE.SphereGeometry(0.138, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
        hair.position.y = 1.405;
        group.add(hair);
        // Ojos (dos puntos oscuros hacia +Z, donde mira el modelo)
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x14100c });
        const eyeGeo = new THREE.SphereGeometry(0.02, 6, 6);
        const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
        eyeL.position.set(-0.05, 1.415, 0.118);
        const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
        eyeR.position.set(0.05, 1.415, 0.118);
        group.add(eyeL, eyeR);

        // ---- Mochila a la espalda (con correas) ----
        const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.17), darkMat);
        pack.position.set(0, 0.97, -0.165);
        group.add(pack);
        const packTop = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.15), darkMat);
        packTop.position.set(0, 1.2, -0.165);
        group.add(packTop);

        // ---- Linterna en la mano derecha, apuntando hacia delante ----
        const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.2, 8), metalMat);
        torch.rotation.x = -Math.PI / 2;
        torch.position.set(0.3, 0.94, 0.18);
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 8), lensMat);
        lens.rotation.y = Math.PI / 2;
        lens.position.set(0.3, 0.94, 0.29);
        group.add(torch, lens);

        return {
            group,
            headY: 1.4,
            // Referencias para la animacion de caminar (net.js): pivotes de
            // piernas y brazos. El brazo derecho lleva la linterna y oscila
            // menos, como al andar sujetando algo.
            limbs: { legL, legR, armL, armR }
        };
    }

    // Anima el caminar del explorador remoto: balanceo de piernas y brazos
    // segun la velocidad real (distancia entre muestras). Se llama desde el
    // bucle de net.js con la fase acumulada; sin movimiento los brazos y
    // piernas vuelven a la posicion de reposo.
    function animateExplorerWalk(model, phase, speedFactor) {
        if (!model || !model.limbs) return;
        const l = model.limbs;
        const swing = Math.sin(phase) * Math.min(0.85, speedFactor);
        // Piernas: una adelante, la otra atras
        l.legL.rotation.x = swing * 0.55;
        l.legR.rotation.x = -swing * 0.55;
        // Brazos en oposicion; el derecho (linterna) oscila menos
        l.armL.rotation.x = -swing * 0.5;
        l.armR.rotation.x = swing * 0.32;
    }