'use client';

import { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';

// Define the Firebase config variables
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Initial data to be used if the user has no saved data
const datosIniciales = [
  { nombre: 'Ualá', limite: 700000, saldo: 700000, compras: [] },
  { nombre: 'BBVA NOE', limite: 290000, saldo: 290000, compras: [] },
  { nombre: 'BBVA TOMAS', limite: 290000, saldo: 290000, compras: [] },
];

const categoriasDisponibles = ['Alimentos', 'Transporte', 'Entretenimiento', 'Servicios', 'Indumentaria', 'Salud', 'Educación', 'Mascotas', 'Otros'];

export default function Home() {
  const [tarjetas, setTarjetas] = useState([]);
  const [tarjetaSeleccionada, setTarjetaSeleccionada] = useState(null);
  const [nuevaCompra, setNuevaCompra] = useState({ descripcion: '', monto: '', cuotas: '', categoria: categoriasDisponibles[0] });
  const [compraEnEdicion, setCompraEnEdicion] = useState(null); 
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Firebase initialization and authentication
  useEffect(() => {
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const auth = getAuth(app);
    
    // Sign in the user
    const signIn = async () => {
      try {
        if (initialAuthToken) {
          await signInWithCustomToken(auth, initialAuthToken);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Firebase Auth Error:", error);
      }
    };
    
    signIn();

    // Listen for auth state changes
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserId(user.uid);
        const userDocRef = doc(db, `artifacts/${appId}/users/${user.uid}/data/tarjetas`);

        // Check if user has existing data
        const userDocSnap = await getDoc(userDocRef);

        if (!userDocSnap.exists()) {
          // If no data exists, save the initial data
          await setDoc(userDocRef, {
            tarjetas: datosIniciales
          });
          setTarjetas(datosIniciales);
          setTarjetaSeleccionada(datosIniciales[0].nombre);
        } else {
          // Listen to real-time changes
          const unsubscribe = onSnapshot(userDocRef, (snapshot) => {
            const data = snapshot.data();
            if (data && data.tarjetas) {
              setTarjetas(data.tarjetas);
              setTarjetaSeleccionada(data.tarjetas[0]?.nombre || null);
            } else {
              setTarjetas(datosIniciales);
              setTarjetaSeleccionada(datosIniciales[0].nombre);
            }
            setLoading(false);
          });
          // Cleanup listener on unmount
          return () => unsubscribe();
        }
      }
      setLoading(false);
    });
  }, []);

  const saveToFirebase = async (updatedTarjetas) => {
    if (userId) {
      const db = getFirestore(initializeApp(firebaseConfig));
      const userDocRef = doc(db, `artifacts/${appId}/users/${userId}/data/tarjetas`);
      try {
        await setDoc(userDocRef, { tarjetas: updatedTarjetas });
      } catch (e) {
        console.error("Error writing document: ", e);
      }
    }
  };

  const tarjetaActiva = tarjetas.find(t => t.nombre === tarjetaSeleccionada);

  const guardarCompra = (e) => {
    e.preventDefault();
    if (nuevaCompra.monto > 0 && nuevaCompra.descripcion) {
      const montoCuota = nuevaCompra.cuotas > 0 ? nuevaCompra.monto / nuevaCompra.cuotas : nuevaCompra.monto;
      
      const compraConCuotas = {
        ...nuevaCompra,
        montoTotal: nuevaCompra.monto,
        montoCuota: montoCuota,
        cuotasRestantes: nuevaCompra.cuotas > 0 ? nuevaCompra.cuotas : 1,
      };

      const tarjetasActualizadas = tarjetas.map(t => {
        if (t.nombre === tarjetaSeleccionada) {
          let saldoActualizado = t.saldo;
          let comprasActualizadas = [...t.compras];

          if (compraEnEdicion !== null) {
            const compraOriginal = t.compras[compraEnEdicion];
            saldoActualizado = saldoActualizado + compraOriginal.montoTotal; 
            comprasActualizadas[compraEnEdicion] = compraConCuotas;
          } else {
            comprasActualizadas = [...comprasActualizadas, compraConCuotas];
          }

          saldoActualizado = saldoActualizado - compraConCuotas.montoTotal;

          return { 
            ...t, 
            saldo: saldoActualizado, 
            compras: comprasActualizadas,
          };
        }
        return t;
      });
      
      setTarjetas(tarjetasActualizadas);
      saveToFirebase(tarjetasActualizadas);
      setNuevaCompra({ descripcion: '', monto: '', cuotas: '', categoria: categoriasDisponibles[0] });
      setCompraEnEdicion(null);
    }
  };

  const pagarCuota = (compraIndex) => {
    const compra = tarjetaActiva.compras[compraIndex];
    if (compra.cuotasRestantes > 0) {
      const nuevoSaldo = tarjetaActiva.saldo + compra.montoCuota; 
      
      const comprasActualizadas = tarjetaActiva.compras.map((c, index) => 
        index === compraIndex
          ? { ...c, cuotasRestantes: c.cuotasRestantes - 1 }
          : c
      );

      const tarjetasActualizadas = tarjetas.map(t => 
        t.nombre === tarjetaSeleccionada
          ? { ...t, saldo: nuevoSaldo, compras: comprasActualizadas }
          : t
      );
      
      setTarjetas(tarjetasActualizadas);
      saveToFirebase(tarjetasActualizadas);
    }
  };

  const eliminarCompra = (compraIndex) => {
    const compraAEliminar = tarjetaActiva.compras[compraIndex];
    const nuevoSaldo = tarjetaActiva.saldo + compraAEliminar.montoTotal;

    const tarjetasActualizadas = tarjetas.map(t =>
      t.nombre === tarjetaSeleccionada
        ? {
            ...t,
            saldo: nuevoSaldo,
            compras: t.compras.filter((_, index) => index !== compraIndex)
          }
        : t
    );
    setTarjetas(tarjetasActualizadas);
    saveToFirebase(tarjetasActualizadas);
  };

  const iniciarEdicion = (compraIndex) => {
    const compraAEditar = tarjetaActiva.compras[compraIndex];
    setNuevaCompra({
      descripcion: compraAEditar.descripcion,
      monto: compraAEditar.monto,
      cuotas: compraAEditar.cuotas,
      categoria: compraAEditar.categoria
    });
    setCompraEnEdicion(compraIndex);
  };

  const resumenGastos = tarjetaActiva?.compras.reduce((resumen, compra) => {
    resumen[compra.categoria] = (resumen[compra.categoria] || 0) + compra.montoTotal;
    return resumen;
  }, {});
  
  const handleCopyToClipboard = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(userId).then(() => {
        alert('ID de usuario copiado al portapapeles');
      }).catch(err => {
        console.error('Error al copiar el ID:', err);
        // Fallback for older browsers
        const tempTextArea = document.createElement('textarea');
        tempTextArea.value = userId;
        document.body.appendChild(tempTextArea);
        tempTextArea.select();
        document.execCommand('copy');
        document.body.removeChild(tempTextArea);
      });
    } else {
      const tempTextArea = document.createElement('textarea');
      tempTextArea.value = userId;
      document.body.appendChild(tempTextArea);
      tempTextArea.select();
      document.execCommand('copy');
      document.body.removeChild(tempTextArea);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-900 text-white font-sans">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-teal-500"></div>
        <p className="mt-4 text-gray-400">Cargando tus datos...</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center p-4 sm:p-8 md:p-12 lg:p-24 bg-gray-900 text-white font-sans">
      <h1 className="text-3xl sm:text-4xl font-bold mb-4 sm:mb-8 text-center text-teal-400 drop-shadow-lg">
        Control de Gastos 💳
      </h1>

      <div className="bg-gray-800 p-4 rounded-xl shadow-md w-full max-w-sm sm:max-w-md mb-8 flex flex-col items-center border-t-4 border-teal-500">
        <p className="text-sm text-gray-400">Tu ID de Usuario:</p>
        <div className="flex items-center space-x-2 mt-1">
          <span className="font-mono text-xs sm:text-sm bg-gray-700 p-2 rounded-md truncate max-w-[200px]">{userId}</span>
          <button onClick={handleCopyToClipboard} className="bg-teal-600 text-white p-2 rounded-md hover:bg-teal-700 transition">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0a2 2 0 012 2v2M8 5a2 2 0 012 2M16 11H4v6a2 2 0 002 2h10a2 2 0 002-2v-6z" />
            </svg>
          </button>
        </div>
      </div>

      <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8 border-t-4 border-teal-500">
        <h2 className="text-xl sm:text-2xl font-semibold mb-4 text-gray-300">
          Seleccionar Tarjeta
        </h2>
        <select 
          value={tarjetaSeleccionada} 
          onChange={(e) => setTarjetaSeleccionada(e.target.value)}
          className="p-3 rounded-xl bg-gray-700 text-white w-full border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition duration-300 ease-in-out"
        >
          {tarjetas.length > 0 ? (
            tarjetas.map(t => (
              <option key={t.nombre} value={t.nombre}>{t.nombre}</option>
            ))
          ) : (
            <option value="">No hay tarjetas</option>
          )}
        </select>
      </div>

      <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8 border-t-4 border-teal-500">
        <h2 className="text-xl sm:text-2xl font-semibold mb-2 text-gray-300">
          Límite de {tarjetaActiva?.nombre}
        </h2>
        <p className="text-3xl sm:text-4xl font-extrabold text-green-400 animate-pulse">
          $ {tarjetaActiva?.saldo.toLocaleString()}
        </p>
        <p className="text-sm sm:text-lg text-gray-400 mt-1">
          Límite original: $ {tarjetaActiva?.limite.toLocaleString()}
        </p>
      </div>

      <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md">
        <h2 className="text-xl sm:text-2xl font-semibold mb-4 text-gray-300">
          {compraEnEdicion !== null ? 'Editar Compra' : 'Añadir Nueva Compra'}
        </h2>
        <form onSubmit={guardarCompra} className="flex flex-col gap-4">
          <input 
            type="text" 
            placeholder="Descripción de la compra" 
            value={nuevaCompra.descripcion}
            onChange={(e) => setNuevaCompra({...nuevaCompra, descripcion: e.target.value})}
            className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition duration-300 ease-in-out"
          />
          <input 
            type="number" 
            placeholder="Monto total"
            value={nuevaCompra.monto}
            onChange={(e) => setNuevaCompra({...nuevaCompra, monto: parseFloat(e.target.value)})}
            className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition duration-300 ease-in-out"
          />
          <input 
            type="number" 
            placeholder="Número de cuotas"
            value={nuevaCompra.cuotas}
            onChange={(e) => setNuevaCompra({...nuevaCompra, cuotas: parseInt(e.target.value)})}
            className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition duration-300 ease-in-out"
          />
          <select
            value={nuevaCompra.categoria}
            onChange={(e) => setNuevaCompra({...nuevaCompra, categoria: e.target.value})}
            className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition duration-300 ease-in-out"
          >
            {categoriasDisponibles.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <button 
            type="submit" 
            className="bg-teal-600 text-white font-bold p-3 rounded-xl hover:bg-teal-700 transition duration-300 ease-in-out shadow-md"
          >
            {compraEnEdicion !== null ? 'Guardar Cambios' : 'Añadir Compra'}
          </button>
        </form>
      </div>

      <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mt-8 border-t-4 border-teal-500">
        <h2 className="text-xl sm:text-2xl font-semibold mb-4 text-gray-300">Resumen de Gastos por Categoría</h2>
        {resumenGastos && Object.keys(resumenGastos).length > 0 ? (
          <ul className="space-y-2">
            {Object.keys(resumenGastos).map(categoria => (
              <li key={categoria} className="flex justify-between items-center text-lg bg-gray-700 p-3 rounded-xl border border-gray-600">
                <span className="font-bold">{categoria}:</span>
                <span>$ {resumenGastos[categoria].toLocaleString()}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-400 text-sm italic">Aún no hay gastos registrados.</p>
        )}
      </div>

      <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mt-8 border-t-4 border-teal-500">
        <h2 className="text-xl sm:text-2xl font-semibold mb-4 text-gray-300">
          Compras de {tarjetaActiva?.nombre}
        </h2>
        {tarjetaActiva?.compras.length > 0 ? (
          <ul className="space-y-4">
            {tarjetaActiva.compras.map((compra, index) => (
              <li key={index} className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-700 p-4 rounded-xl border border-gray-600">
                <div className="mb-2 sm:mb-0">
                  <p className="font-bold text-lg">{compra.descripcion}</p>
                  <p className="text-sm text-gray-400">{compra.categoria}</p>
                  <p className="text-base text-gray-200">
                    $ {compra.montoTotal.toLocaleString()} en {compra.cuotas} cuotas
                  </p>
                  {compra.cuotasRestantes > 0 && (
                    <p className="text-sm text-gray-400 italic">
                      Cuotas restantes: {compra.cuotasRestantes}
                    </p>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2 w-full sm:w-auto">
                  {compra.cuotasRestantes > 0 && (
                    <button 
                      onClick={() => pagarCuota(index)} 
                      className="bg-green-600 p-2 rounded-xl hover:bg-green-700 text-sm transition duration-300 ease-in-out font-medium"
                    >
                      Pagar cuota
                    </button>
                  )}
                  <button
                    onClick={() => iniciarEdicion(index)}
                    className="bg-yellow-500 p-2 rounded-xl hover:bg-yellow-600 text-sm transition duration-300 ease-in-out font-medium"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => eliminarCompra(index)}
                    className="bg-red-600 p-2 rounded-xl hover:bg-red-700 text-sm transition duration-300 ease-in-out font-medium"
                  >
                    Eliminar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-400 text-sm italic">No hay compras registradas para esta tarjeta.</p>
        )}
      </div>
    </main>
  );
}
