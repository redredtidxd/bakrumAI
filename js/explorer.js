/* ==========================================================================
       9. MODELO DEL EXPLORADOR (jugadores remotos del multijugador)
       ==========================================================================
       Humanoides procedimentales con primitivas: pantalon oscuro, torso con
       el color del jugador (para distinguirlos en la sala), cabeza, mochila y
       una linterna en la mano derecha. Devuelve { group, headY } para que el
       HUD de nombres y el foco de luz se coloquen a la altura correcta.
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
        const metalMat = new THREE.MeshStandardMaterial({ color: 0x55555e, metalness: 0.6, roughness: 0.4 });
        const lensMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });

        const group = new THREE.Group();

        // Piernas
        const legGeo = new THREE.CylinderGeometry(0.055, 0.065, 0.62, 8);
        const legL = new THREE.Mesh(legGeo, darkMat);
        legL.position.set(-0.09, 0.31, 0);
        const legR = new THREE.Mesh(legGeo, darkMat);
        legR.position.set(0.09, 0.31, 0);
        group.add(legL, legR);

        // Torso (cazadora del color del jugador)
        const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.5, 10), clothMat);
        torso.position.y = 0.87;
        group.add(torso);

        // Brazos
        const armGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.55, 8);
        const armL = new THREE.Mesh(armGeo, clothMat);
        armL.position.set(-0.21, 1.0, 0);
        armL.rotation.z = 0.14;
        const armR = new THREE.Mesh(armGeo, clothMat);
        armR.position.set(0.21, 1.0, 0);
        armR.rotation.z = -0.14;
        group.add(armL, armR);

        // Cabeza
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), skinMat);
        head.position.y = 1.38;
        group.add(head);

        // Mochila a la espalda
        const pack = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.4, 0.16), darkMat);
        pack.position.set(0, 0.95, -0.16);
        group.add(pack);

        // Linterna en la mano derecha, apuntando hacia delante
        const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.2, 8), metalMat);
        torch.rotation.x = -Math.PI / 2;
        torch.position.set(0.3, 0.92, 0.2);
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 8), lensMat);
        lens.rotation.y = Math.PI / 2;
        lens.position.set(0.3, 0.92, 0.31);
        group.add(torch, lens);

        return { group, headY: 1.38 };
    }