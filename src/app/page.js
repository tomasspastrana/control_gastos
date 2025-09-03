'use client';

import { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, onSnapshot, setDoc } from 'firebase/firestore';

// --- Configuración de Firebase ---
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
};

const appIdPath = 'control-de-gastos-app'; 

const initialAuthToken = process.env.NEXT_PUBLIC_INITIAL_AUTH_TOKEN || null;
const LOCAL_STORAGE_KEY = 'activeUserId'; // Key for saving the ID

// --- Datos y Categorías Iniciales ---
const datosIniciales = [
  { nombre: 'Ualá', limite: 700000, saldo: 700000, compras: [] },
  { nombre: 'BBVA NOE', limite: 290000, saldo: 290000, compras: [] },
  { nombre: 'BBVA TOMAS', limite: 290000, saldo: 290000, compras: [] },
];
const categoriasDisponibles = ['Alimentos', 'Transporte', 'Entretenimiento', 'Servicios', 'Indumentaria', 'Salud', 'Educación', 'Mascotas', 'Otros'];

function AuthWrapper() {
  const [tarjetas, setTarjetas] = useState([]);
  const [tarjetaSeleccionada, setTarjetaSeleccionada] = useState(null);
  const [nuevaCompra, setNuevaCompra] = useState({ descripcion: '', monto: '', cuotas: '', categoria: categoriasDisponibles[0] });
  const [compraEnEdicion, setCompraEnEdicion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [db, setDb] = useState(null);
  
  const [authUserId, setAuthUserId] = useState(null); 
  const [activeUserId, setActiveUserId] = useState(null); 
  const [idParaCargar, setIdParaCargar] = useState(''); 
  const [copySuccess, setCopySuccess] = useState(''); 
  const [postergada, setPostergada] = useState(false);
  // ***** CAMBIO #1: Nuevo estado para las cuotas ya pagadas *****
  const [cuotasPagadas, setCuotasPagadas] = useState('');

  // Efecto para inicializar Firebase y autenticar al usuario
  useEffect(() => {
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
      console.error("Configuración de Firebase incompleta. Revisa las variables de entorno en Vercel.");
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
                const savedId = localStorage.getItem(LOCAL_STORAGE_KEY);
                if (savedId) {
                    setActiveUserId(savedId);
                } else {
                    setActiveUserId(user.uid);
                }
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
    const userDocRef = doc(db, `artifacts/${appIdPath}/users/${activeUserId}/data/tarjetas`);

    const unsubscribeSnapshot = onSnapshot(userDocRef, async (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setTarjetas(data.tarjetas || []);
        if (data.tarjetas?.length > 0) {
            setTarjetaSeleccionada(prev => data.tarjetas.some(t => t.nombre === prev) ? prev : data.tarjetas[0].nombre);
        }
      } else {
        if (activeUserId === authUserId && authUserId !== null) { 
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
  }, [db, activeUserId]);


  const saveToFirebase = async (updatedTarjetas) => {
    if (activeUserId && db) {
      const userDocRef = doc(db, `artifacts/${appIdPath}/users/${activeUserId}/data/tarjetas`);
      try {
        await setDoc(userDocRef, { tarjetas: updatedTarjetas });
      } catch (e) { console.error("Error al guardar en Firebase: ", e); }
    }
  };
  
  const handleCargarId = () => {
    const idToLoad = idParaCargar.trim();
    if (idToLoad && idToLoad !== activeUserId) {
      setActiveUserId(idToLoad);
      localStorage.setItem(LOCAL_STORAGE_KEY, idToLoad);
    }
  };

  const handleResetToMyId = () => {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    setActiveUserId(authUserId);
    setIdParaCargar('');
  };

  const tarjetaActiva = tarjetas.find(t => t.nombre === tarjetaSeleccionada);

  const guardarCompra = (e) => {
    e.preventDefault();
    if (!tarjetaActiva || !nuevaCompra.monto || !(parseFloat(nuevaCompra.monto) > 0) || !nuevaCompra.descripcion) return;
    
    const montoNum = parseFloat(nuevaCompra.monto);
    const cuotasNum = Number.isInteger(parseInt(nuevaCompra.cuotas)) && nuevaCompra.cuotas > 0 ? parseInt(nuevaCompra.cuotas) : 1;
    // ***** CAMBIO #2: Calculamos las cuotas restantes correctamente *****
    const cuotasPagadasNum = Number.isInteger(parseInt(cuotasPagadas)) ? parseInt(cuotasPagadas) : 0;
    const cuotasRestantesNum = Math.max(0, cuotasNum - cuotasPagadasNum);

    const compraFinal = {
      descripcion: nuevaCompra.descripcion,
      categoria: nuevaCompra.categoria,
      montoTotal: montoNum,
      cuotas: cuotasNum,
      montoCuota: cuotasNum > 0 ? montoNum / cuotasNum : montoNum,
      cuotasRestantes: cuotasRestantesNum,
      pagada: cuotasRestantesNum === 0,
      postergada: postergada, 
    };

    const tarjetasActualizadas = tarjetas.map(t => {
      if (t.nombre === tarjetaSeleccionada) {
        let saldoActualizado = t.saldo;
        let comprasActualizadas;

        if (compraEnEdicion !== null) {
          const compraOriginal = t.compras[compraEnEdicion];
          saldoActualizado += compraOriginal.montoTotal; // Devolvemos el monto total para un cálculo limpio
          
          comprasActualizadas = [...t.compras];
          comprasActualizadas[compraEnEdicion] = compraFinal;
        } else {
          comprasActualizadas = [...t.compras, compraFinal];
        }

        saldoActualizado -= compraFinal.montoTotal; // Restamos el monto total de la nueva compra/editada
        return { ...t, saldo: saldoActualizado, compras: comprasActualizadas };
      }
      return t;
    });
    
    saveToFirebase(tarjetasActualizadas);
    setNuevaCompra({ descripcion: '', monto: '', cuotas: '', categoria: categoriasDisponibles[0] });
    setCompraEnEdicion(null);
    setPostergada(false);
    setCuotasPagadas(''); // Reseteamos el nuevo campo
  };
    
  const eliminarCompra = (compraIndex) => {
    const compraAEliminar = tarjetaActiva?.compras[compraIndex];
    if (!compraAEliminar) return;

    const montoADevolver = compraAEliminar.montoCuota * compraAEliminar.cuotasRestantes;

    const tarjetasActualizadas = tarjetas.map(t =>
      t.nombre === tarjetaSeleccionada
        ? { ...t,
            saldo: t.saldo + montoADevolver,
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
    setPostergada(compraAEditar.postergada || false);
    // ***** CAMBIO #3: Calculamos y seteamos las cuotas ya pagadas para la edición *****
    const pagadas = compraAEditar.cuotas - compraAEditar.cuotasRestantes;
    setCuotasPagadas(pagadas > 0 ? pagadas : '');
  };

  const handleRecalcularSaldo = () => {
    if (!tarjetaActiva) return;

    const totalDeudaPendiente = tarjetaActiva.compras.reduce((total, compra) => {
      return total + (compra.montoCuota * compra.cuotasRestantes);
    }, 0);

    const saldoCorrecto = tarjetaActiva.limite - totalDeudaPendiente;

    const tarjetasActualizadas = tarjetas.map(t =>
      t.nombre === tarjetaSeleccionada
        ? { ...t, saldo: saldoCorrecto }
        : t
    );
    
    saveToFirebase(tarjetasActualizadas);
  };

  const resumenGastos = tarjetaActiva?.compras.reduce((resumen, compra) => {
    resumen[compra.categoria] = (resumen[compra.categoria] || 0) + compra.montoTotal;
    return resumen;
  }, {});
  
  const handleCopyToClipboard = () => {
    if (!authUserId) return;
    navigator.clipboard.writeText(authUserId).then(() => {
        setCopySuccess('¡ID Copiado!');
        setTimeout(() => setCopySuccess(''), 2000);
    });
  };

  const resumenMes = useMemo(() => {
    if (!tarjetaActiva) return 0;
    return tarjetaActiva.compras.reduce((total, compra) => {
      if (compra.cuotasRestantes > 0 && !compra.postergada) {
        return total + compra.montoCuota;
      }
      return total;
    }, 0);
  }, [tarjetaActiva]);

  const handlePagarResumen = () => {
    if (!tarjetaActiva || resumenMes <= 0) return;

    const comprasDespuesDelPago = tarjetaActiva.compras.map(compra => {
        let updatedCompra = { ...compra };
        
        if (updatedCompra.cuotasRestantes > 0 && !updatedCompra.postergada) {
            const nuevasCuotasRestantes = updatedCompra.cuotasRestantes - 1;
            updatedCompra.cuotasRestantes = nuevasCuotasRestantes;
            updatedCompra.pagada = nuevasCuotasRestantes === 0;
        }

        if (updatedCompra.postergada) {
            updatedCompra.postergada = false;
        }

        return updatedCompra;
    });

    const tarjetasActualizadas = tarjetas.map(t => {
      if (t.nombre === tarjetaSeleccionada) {
        const nuevoSaldo = Math.min(t.limite, t.saldo + resumenMes);
        return { ...t, saldo: nuevoSaldo, compras: comprasDespuesDelPago };
      }
      return t;
    });

    saveToFirebase(tarjetasActualizadas);
  };

  const handlePagarCuota = (compraIndex) => {
    const compra = tarjetaActiva?.compras[compraIndex];
    if (!compra || compra.cuotasRestantes <= 0) return;

    const tarjetasActualizadas = tarjetas.map(t => {
        if (t.nombre === tarjetaSeleccionada) {
            const nuevoSaldo = Math.min(t.limite, t.saldo + compra.montoCuota);
            const comprasActualizadas = t.compras.map((c, i) => {
                if (i === compraIndex) {
                    const nuevasCuotasRestantes = c.cuotasRestantes - 1;
                    return {
                        ...c,
                        cuotasRestantes: nuevasCuotasRestantes,
                        pagada: nuevasCuotasRestantes === 0
                    };
                }
                return c;
            });
            return { ...t, saldo: nuevoSaldo, compras: comprasActualizadas };
        }
        return t;
    });
    saveToFirebase(tarjetasActualizadas);
  };

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-900 text-white font-sans">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-teal-500"></div>
        <p className="mt-4 text-gray-400">Conectando...</p>
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
                  <button onClick={handleCargarId} className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition font-semibold">Cargar</button>
                  {authUserId !== activeUserId && (
                    <button onClick={handleResetToMyId} className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 transition font-semibold">Volver a mi ID</button>
                  )}
              </div>
              {authUserId !== activeUserId && (
                <p className="text-yellow-400 text-xs mt-2 text-center">
                    Estás viendo los datos de otro usuario.
                </p>
              )}
          </div>
        </div>
      )}
      
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
                <div className="flex justify-between items-center mb-2">
                    <h2 className="text-xl sm:text-2xl font-semibold text-gray-300">
                        Saldo disponible de {tarjetaActiva.nombre}
                    </h2>
                    <button onClick={handleRecalcularSaldo} title="Recalcular saldo si es incorrecto" className="bg-orange-600 text-white px-3 py-1 text-xs font-bold rounded-lg hover:bg-orange-700 transition">
                        Recalcular
                    </button>
                </div>
                <p className="text-3xl sm:text-4xl font-extrabold text-green-400">
                    $ {tarjetaActiva.saldo.toLocaleString('es-AR')}
                </p>
                <p className="text-sm sm:text-lg text-gray-400 mt-1">
                    Límite original: $ {tarjetaActiva.limite.toLocaleString('es-AR')}
                </p>
            </div>

            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8 border-t-4 border-blue-500">
                <h2 className="text-xl sm:text-2xl font-semibold mb-2 text-gray-300">
                    Resumen del Mes
                </h2>
                <p className="text-3xl sm:text-4xl font-extrabold text-blue-400">
                    $ {resumenMes.toLocaleString('es-AR')}
                </p>
                <button 
                    onClick={handlePagarResumen} 
                    disabled={resumenMes <= 0}
                    className="w-full mt-4 bg-blue-600 text-white font-bold p-3 rounded-xl hover:bg-blue-700 transition duration-300 ease-in-out shadow-md disabled:bg-gray-500 disabled:cursor-not-allowed"
                >
                    Pagar Resumen
                </button>
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
                      placeholder="Número de cuotas (ej: 6)"
                      value={nuevaCompra.cuotas}
                      onChange={(e) => setNuevaCompra({...nuevaCompra, cuotas: e.target.value === '' ? '' : parseInt(e.target.value, 10)})}
                      className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                  />
                  {/* ***** CAMBIO #4: El nuevo campo para cuotas pagadas ***** */}
                  <input 
                      type="number" 
                      placeholder="¿Cuántas cuotas ya pagaste? (ej: 2)"
                      value={cuotasPagadas}
                      onChange={(e) => setCuotasPagadas(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
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
                  <div className="flex items-center gap-2 text-gray-300">
                    <input 
                        type="checkbox"
                        id="postergada-checkbox"
                        checked={postergada}
                        onChange={(e) => setPostergada(e.target.checked)}
                        className="h-4 w-4 rounded bg-gray-700 border-gray-600 text-teal-500 focus:ring-teal-500"
                    />
                    <label htmlFor="postergada-checkbox">Pagar en el próximo resumen</label>
                  </div>
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
                        <div className={compra.pagada ? 'opacity-50' : ''}>
                            <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-bold text-lg">{compra.descripcion}</p>
                                {compra.pagada && <span className="text-xs font-bold text-white bg-green-600 px-2 py-1 rounded-full">PAGADA</span>}
                                {compra.postergada && <span className="text-xs font-bold text-black bg-yellow-400 px-2 py-1 rounded-full">POSTERGADA</span>}
                            </div>
                            <p className="text-sm text-gray-400">{compra.categoria}</p>
                            <p className="text-base text-gray-200">
                                $ {compra.montoTotal.toLocaleString('es-AR')} en {compra.cuotas} cuota(s)
                            </p>
                            <p className="text-sm text-teal-400 italic">
                                Cuotas restantes: {compra.cuotasRestantes}
                            </p>
                        </div>
                        <div className="flex flex-row sm:flex-col space-x-2 sm:space-x-0 sm:space-y-2 w-full sm:w-auto justify-end">
                            {compra.cuotasRestantes > 0 && (
                                <button onClick={() => handlePagarCuota(index)} className="bg-green-600 p-2 rounded-xl hover:bg-green-700 text-sm transition font-medium">Pagar Cuota</button>
                            )}
                            <button onClick={() => iniciarEdicion(index)} className="bg-yellow-500 p-2 rounded-xl hover:bg-yellow-600 text-sm transition font-medium disabled:opacity-50" disabled={compra.pagada}>Editar</button>
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

export default function HomePage() {
  return <AuthWrapper />;
}

