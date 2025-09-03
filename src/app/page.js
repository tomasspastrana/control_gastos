'use client';

import { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, onSnapshot, setDoc } from 'firebase/firestore';

// --- Configuración de Firebase ---
// Lee la configuración desde las Variables de Entorno de Vercel.
// Esta es la forma correcta y segura para Next.js
const firebaseConfigString = process.env.NEXT_PUBLIC_FIREBASE_CONFIG;
const firebaseConfig = firebaseConfigString ? JSON.parse(firebaseConfigString) : {};
const appId = 'control-de-gastos-app'; // Un ID simple para la ruta de la base de datos

// El token inicial probablemente no existirá en Vercel, el código ya maneja esto.
const initialAuthToken = process.env.NEXT_PUBLIC_INITIAL_AUTH_TOKEN || null;

// --- Datos y Categorías Iniciales ---
const datosIniciales = [
  { nombre: 'Tarjeta Principal', limite: 700000, saldo: 700000, compras: [] },
  { nombre: 'Tarjeta Secundaria', limite: 290000, saldo: 290000, compras: [] },
];
const categoriasDisponibles = ['Alimentos', 'Transporte', 'Entretenimiento', 'Servicios', 'Indumentaria', 'Salud', 'Educación', 'Mascotas', 'Otros'];

function AuthWrapper() {
  const [tarjetas, setTarjetas] = useState([]);
  const [tarjetaSeleccionada, setTarjetaSeleccionada] = useState(null);
  const [nuevaCompra, setNuevaCompra] = useState({ descripcion: '', monto: '', cuotas: '', categoria: categoriasDisponibles[0] });
  const [compraEnEdicion, setCompraEnEdicion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [db, setDb] = useState(null);
  
  // --- Estados para manejar múltiples usuarios ---
  const [authUserId, setAuthUserId] = useState(null); // El ID de este dispositivo
  const [activeUserId, setActiveUserId] = useState(null); // El ID de los datos que estamos viendo
  const [idParaCargar, setIdParaCargar] = useState(''); // El valor del input para cargar un ID
  const [copySuccess, setCopySuccess] = useState(''); // Mensaje de éxito al copiar

  // Efecto para inicializar Firebase y autenticar al usuario
  useEffect(() => {
    if (!firebaseConfig.projectId) {
      console.error("Configuración de Firebase no encontrada. Revisa las variables de entorno en Vercel.");
      setLoading(false);
      return;
    }

    try {
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const firestore = getFirestore(app);
        setDb(firestore);

        const signInUser = async () => {
            try {
                if (initialAuthToken) await signInWithCustomToken(auth, initialAuthToken);
                else await signInAnonymously(auth);
            } catch (error) { console.error("Error de autenticación:", error); }
        };
        signInUser();

        const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
            if (user) {
                setAuthUserId(user.uid);
                if (!activeUserId) setActiveUserId(user.uid);
            } else {
                setAuthUserId(null);
                setActiveUserId(null);
            }
        });

        return () => unsubscribeAuth();
    } catch (error) {
        console.error("Error inicializando Firebase:", error);
        setLoading(false);
    }
  }, []);

  // Efecto para cargar los datos del usuario activo
  useEffect(() => {
    if (!db || !activeUserId) return;

    setLoading(true);
    const userDocRef = doc(db, `artifacts/${appId}/users/${activeUserId}/data/tarjetas`);

    const unsubscribeSnapshot = onSnapshot(userDocRef, async (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setTarjetas(data.tarjetas || []);
        if (data.tarjetas?.length > 0) {
            setTarjetaSeleccionada(prev => data.tarjetas.some(t => t.nombre === prev) ? prev : data.tarjetas[0].nombre);
        }
      } else {
        if (activeUserId === authUserId) {
          await setDoc(userDocRef, { tarjetas: datosIniciales });
          setTarjetas(datosIniciales);
          setTarjetaSeleccionada(datosIniciales[0]?.nombre || null);
        } else {
          setTarjetas([]);
          setTarjetaSeleccionada(null);
          console.warn("El ID cargado no tiene datos.");
        }
      }
      setLoading(false);
    }, (error) => {
      console.error("Error al leer de Firestore:", error);
      setLoading(false);
    });

    return () => unsubscribeSnapshot();
  }, [db, activeUserId, authUserId]);


  const saveToFirebase = async (updatedTarjetas) => {
    if (activeUserId && db) {
      const userDocRef = doc(db, `artifacts/${appId}/users/${activeUserId}/data/tarjetas`);
      try {
        await setDoc(userDocRef, { tarjetas: updatedTarjetas });
      } catch (e) { console.error("Error al guardar en Firebase: ", e); }
    }
  };
  
  const handleCargarId = () => {
    if (idParaCargar && idParaCargar.trim() !== '' && idParaCargar.trim() !== activeUserId) {
      setActiveUserId(idParaCargar.trim());
    }
  };

  const tarjetaActiva = tarjetas.find(t => t.nombre === tarjetaSeleccionada);

  const guardarCompra = (e) => {
    e.preventDefault();
    if (!tarjetaActiva || !nuevaCompra.monto || !(parseFloat(nuevaCompra.monto) > 0) || !nuevaCompra.descripcion) return;
    
    const montoNum = parseFloat(nuevaCompra.monto);
    const cuotasNum = Number.isInteger(parseInt(nuevaCompra.cuotas)) && nuevaCompra.cuotas > 0 ? parseInt(nuevaCompra.cuotas) : 1;
    
    const compraFinal = {
      descripcion: nuevaCompra.descripcion,
      categoria: nuevaCompra.categoria,
      montoTotal: montoNum,
      cuotas: cuotasNum,
      montoCuota: montoNum / cuotasNum,
      cuotasRestantes: cuotasNum,
    };

    const tarjetasActualizadas = tarjetas.map(t => {
      if (t.nombre === tarjetaSeleccionada) {
        let saldoActualizado = t.saldo;
        let comprasActualizadas;
        if (compraEnEdicion !== null) {
          const compraOriginal = t.compras[compraEnEdicion];
          saldoActualizado += compraOriginal.montoTotal;
          comprasActualizadas = [...t.compras];
          comprasActualizadas[compraEnEdicion] = compraFinal;
        } else {
          comprasActualizadas = [...t.compras, compraFinal];
        }
        saldoActualizado -= compraFinal.montoTotal;
        return { ...t, saldo: saldoActualizado, compras: comprasActualizadas };
      }
      return t;
    });
    
    saveToFirebase(tarjetasActualizadas);
    setNuevaCompra({ descripcion: '', monto: '', cuotas: '', categoria: categoriasDisponibles[0] });
    setCompraEnEdicion(null);
  };
    
  const pagarCuota = (compraIndex) => {
    const compra = tarjetaActiva?.compras[compraIndex];
    if (!compra || compra.cuotasRestantes <= 0) return;

    const tarjetasActualizadas = tarjetas.map(t =>
      t.nombre === tarjetaSeleccionada
        ? { ...t, 
            saldo: t.saldo + compra.montoCuota, 
            compras: t.compras.map((c, i) => i === compraIndex ? { ...c, cuotasRestantes: c.cuotasRestantes - 1 } : c) 
          }
        : t
    );
    saveToFirebase(tarjetasActualizadas);
  };

  const eliminarCompra = (compraIndex) => {
    const compraAEliminar = tarjetaActiva?.compras[compraIndex];
    if (!compraAEliminar) return;

    const tarjetasActualizadas = tarjetas.map(t =>
      t.nombre === tarjetaSeleccionada
        ? { ...t,
            saldo: t.saldo + compraAEliminar.montoTotal,
            compras: t.compras.filter((_, i) => i !== compraIndex)
          }
        : t
    );
    saveToFirebase(tarjetasActualizadas);
  };

  const iniciarEdicion = (compraIndex) => {
    const compraAEditar = tarjetaActiva?.compras[compraIndex];
    if (!compraAEditar) return;
    setNuevaCompra({
      descripcion: compraAEditar.descripcion,
      monto: compraAEditar.montoTotal,
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
    if (!authUserId) return;
    const tempInput = document.createElement('input');
    tempInput.value = authUserId;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
    setCopySuccess('¡ID Copiado!');
    setTimeout(() => setCopySuccess(''), 2000); // El mensaje desaparece después de 2 segundos
  };

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-900 text-white font-sans">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-teal-500"></div>
        <p className="mt-4 text-gray-400">Cargando datos...</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center p-4 sm:p-8 md:p-12 lg:p-24 bg-gray-900 text-white font-sans">
      <h1 className="text-3xl sm:text-4xl font-bold mb-4 sm:mb-8 text-center text-teal-400 drop-shadow-lg">
        Control de Gastos 💳
      </h1>

      {authUserId && (
        <div className="bg-gray-800 p-4 rounded-xl shadow-md w-full max-w-sm sm:max-w-md mb-8 flex flex-col items-center border-t-4 border-teal-500">
          <p className="text-sm text-gray-400">ID de este Dispositivo (para compartir):</p>
          <div className="flex items-center space-x-2 mt-1">
            <span className="font-mono text-xs sm:text-sm bg-gray-700 p-2 rounded-md truncate max-w-[200px]">{authUserId}</span>
            <button onClick={handleCopyToClipboard} className="bg-teal-600 text-white p-2 rounded-md hover:bg-teal-700 transition">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
            </button>
          </div>
          {copySuccess && <p className="text-green-400 text-sm mt-2">{copySuccess}</p>}
          <div className="w-full mt-4">
              <p className="text-sm text-gray-400 mb-1">Cargar datos desde otro ID:</p>
              <div className="flex items-center space-x-2">
                  <input 
                    type="text" 
                    placeholder="Pega un ID aquí" 
                    value={idParaCargar}
                    onChange={(e) => setIdParaCargar(e.target.value)}
                    className="p-2 w-full rounded-md bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                  />
                  <button onClick={handleCargarId} className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition font-semibold">Cargar</button>
              </div>
          </div>
        </div>
      )}

      { /* El resto de la UI permanece igual */ }
      
      <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8 border-t-4 border-teal-500">
        <h2 className="text-xl sm:text-2xl font-semibold mb-4 text-gray-300">
          Seleccionar Tarjeta
        </h2>
        <select 
          value={tarjetaSeleccionada || ''} 
          onChange={(e) => setTarjetaSeleccionada(e.target.value)}
          className="p-3 rounded-xl bg-gray-700 text-white w-full border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
          disabled={!tarjetas || tarjetas.length === 0}
        >
          {tarjetas.length > 0 ? (
            tarjetas.map(t => (
              <option key={t.nombre} value={t.nombre}>{t.nombre}</option>
            ))
          ) : (
            <option value="" disabled>No hay datos para mostrar</option>
          )}
        </select>
      </div>

      {tarjetaActiva && (
        <>
            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8 border-t-4 border-teal-500">
                <h2 className="text-xl sm:text-2xl font-semibold mb-2 text-gray-300">
                    Saldo disponible de {tarjetaActiva.nombre}
                </h2>
                <p className="text-3xl sm:text-4xl font-extrabold text-green-400">
                    $ {tarjetaActiva.saldo.toLocaleString('es-AR')}
                </p>
                <p className="text-sm sm:text-lg text-gray-400 mt-1">
                    Límite original: $ {tarjetaActiva.limite.toLocaleString('es-AR')}
                </p>
            </div>

            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8">
                <h2 className="text-xl sm:text-2xl font-semibold mb-4 text-gray-300">
                    {compraEnEdicion !== null ? 'Editar Compra' : 'Añadir Nueva Compra'}
                </h2>
                <form onSubmit={guardarCompra} className="flex flex-col gap-4">
                  <input 
                      type="text" 
                      placeholder="Descripción de la compra" 
                      value={nuevaCompra.descripcion}
                      onChange={(e) => setNuevaCompra({...nuevaCompra, descripcion: e.target.value})}
                      className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                      required
                  />
                  <input 
                      type="number" 
                      placeholder="Monto total"
                      value={nuevaCompra.monto}
                      onChange={(e) => setNuevaCompra({...nuevaCompra, monto: e.target.value === '' ? '' : parseFloat(e.target.value)})}
                      className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                      required
                  />
                  <input 
                      type="number" 
                      placeholder="Número de cuotas (1 por defecto)"
                      value={nuevaCompra.cuotas}
                      onChange={(e) => setNuevaCompra({...nuevaCompra, cuotas: e.target.value === '' ? '' : parseInt(e.target.value, 10)})}
                      className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                  />
                  <select
                      value={nuevaCompra.categoria}
                      onChange={(e) => setNuevaCompra({...nuevaCompra, categoria: e.target.value})}
                      className="p-3 rounded-xl bg-gray-700 text-white w-full border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
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
                    {Object.entries(resumenGastos).map(([categoria, monto]) => (
                    <li key={categoria} className="flex justify-between items-center text-lg bg-gray-700 p-3 rounded-xl border border-gray-600">
                        <span className="font-bold">{categoria}:</span>
                        <span>$ {monto.toLocaleString('es-AR')}</span>
                    </li>
                    ))}
                </ul>
                ) : ( <p className="text-gray-400 text-sm italic">Aún no hay gastos registrados.</p> )}
            </div>

            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mt-8 border-t-4 border-teal-500">
                <h2 className="text-xl sm:text-2xl font-semibold mb-4 text-gray-300">
                Compras de {tarjetaActiva.nombre}
                </h2>
                {tarjetaActiva.compras.length > 0 ? (
                <ul className="space-y-4">
                    {tarjetaActiva.compras.map((compra, index) => (
                    <li key={index} className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-700 p-4 rounded-xl border border-gray-600 gap-3">
                        <div>
                        <p className="font-bold text-lg">{compra.descripcion}</p>
                        <p className="text-sm text-gray-400">{compra.categoria}</p>
                        <p className="text-base text-gray-200">
                            $ {compra.montoTotal.toLocaleString('es-AR')} en {compra.cuotas} cuota(s)
                        </p>
                        {compra.cuotas > 1 && (
                            <p className="text-sm text-teal-400 italic">
                                Cuotas restantes: {compra.cuotasRestantes}
                            </p>
                        )}
                        </div>
                        <div className="flex flex-row sm:flex-col space-x-2 sm:space-x-0 sm:space-y-2 w-full sm:w-auto justify-end">
                            {compra.cuotas > 1 && compra.cuotasRestantes > 0 && (
                                <button onClick={() => pagarCuota(index)} className="bg-green-600 p-2 rounded-xl hover:bg-green-700 text-sm transition font-medium">Pagar</button>
                            )}
                            <button onClick={() => iniciarEdicion(index)} className="bg-yellow-500 p-2 rounded-xl hover:bg-yellow-600 text-sm transition font-medium">Editar</button>
                            <button onClick={() => eliminarCompra(index)} className="bg-red-600 p-2 rounded-xl hover:bg-red-700 text-sm transition font-medium">Eliminar</button>
                        </div>
                    </li>
                    ))}
                </ul>
                ) : ( <p className="text-gray-400 text-sm italic">No hay compras registradas para esta tarjeta.</p> )}
            </div>
        </>
      )}
    </main>
  );
}

// El default export es el componente de la página
export default function HomePage() {
  return <AuthWrapper />;
}
