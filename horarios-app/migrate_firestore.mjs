import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, writeBatch, doc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCJZeUE4k1XHIyxQ4lRmKvlH0eHeAZky4o",
  authDomain: "crew-bb7bb.firebaseapp.com",
  projectId: "crew-bb7bb",
  storageBucket: "crew-bb7bb.firebasestorage.app",
  messagingSenderId: "613900683663",
  appId: "1:613900683663:web:f825e871a9cbb32f3ba3fa"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function formatDateString(dateStr) {
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
}

async function migrateData() {
    const dataPath = './Historico_Procesado.json';
    if (!fs.existsSync(dataPath)) {
        console.error("El archivo Historico_Procesado.json no existe.");
        return;
    }

    const rawData = fs.readFileSync(dataPath, 'utf8');
    const employees = JSON.parse(rawData);

    let batch = writeBatch(db);
    let operationCount = 0;
    let totalWritten = 0;
    
    console.log("Iniciando migración masiva a Firestore...");
    
    for (const emp of employees) {
        const collabId = emp.legajo;
        for (const [rawDate, record] of Object.entries(emp.records)) {
            const dateISO = formatDateString(rawDate);
            if (!dateISO) continue;

            const docId = `${collabId}_${dateISO}`;
            const docRef = doc(db, "planificacion", docId);
            
            const payload = {
                colaboradorId: collabId,
                fecha: dateISO,
                ...record
            };
            
            batch.set(docRef, payload);
            operationCount++;

            if (operationCount === 500) {
                console.log(`Escribiendo batch de ${operationCount} documentos...`);
                await batch.commit();
                totalWritten += operationCount;
                operationCount = 0;
                batch = writeBatch(db);
            }
        }
    }

    if (operationCount > 0) {
        console.log(`Escribiendo batch final de ${operationCount} documentos...`);
        await batch.commit();
        totalWritten += operationCount;
    }

    console.log(`¡Migración finalizada! Se procesaron ${totalWritten} turnos históricos en Firestore.`);
    process.exit(0);
}

migrateData().catch(console.error);
