'use client';

import { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, onSnapshot, setDoc } from 'firebase/firestore';

// --- Configuración de Firebase ---
// Las variables de entorno se reemplazarán en el entorno de ejecución
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appIdPath = typeof __app_id !== 'undefined' ? __app_id : 'control-de-gastos-app';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

const LOCAL_STORAGE_KEY = 'activeUserId'; // Key para guardar el ID

// --- Datos y Categorías Iniciales ---
const datosIniciales = {
    tarjetas: [
        { nombre: 'Ualá', limite: 700000, saldo: 700000, compras: [] },
        { nombre: 'BBVA NOE', limite: 290000, saldo: 290000, compras: [] },
        { nombre: 'BBVA TOMAS', limite: 290000, saldo: 290000, compras: [] },
    ],
    deudas: []
};

const categoriasDisponibles = ['Préstamo', 'Servicios', 'Alimentos', 'Transporte', 'Entretenimiento', 'Indumentaria', 'Salud', 'Educación', 'Mascotas', 'Otros'];

function AuthWrapper() {
    const [tarjetas, setTarjetas] = useState([]);
    const [deudas, setDeudas] = useState([]);
    const [seleccion, setSeleccion] = useState(null); // Puede ser nombre de tarjeta o "Deudas"
    const [nuevoItem, setNuevoItem] = useState({ descripcion: '', monto: '', cuotas: '', categoria: categoriasDisponibles[0] });
    const [itemEnEdicion, setItemEnEdicion] = useState(null); // index del item
    const [loading, setLoading] = useState(true);
    const [db, setDb] = useState(null);

    const [authUserId, setAuthUserId] = useState(null);
    const [activeUserId, setActiveUserId] = useState(null);
    const [idParaCargar, setIdParaCargar] = useState('');
    const [copySuccess, setCopySuccess] = useState('');
    const [postergada, setPostergada] = useState(false);
    const [cuotasPagadas, setCuotasPagadas] = useState('');
    const [mostrarFormularioTarjeta, setMostrarFormularioTarjeta] = useState(false);
    const [nuevaTarjeta, setNuevaTarjeta] = useState({ nombre: '', limite: '', mostrarSaldo: true });

    // Efecto para inicializar Firebase y autenticar al usuario
    useEffect(() => {
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
                    const idToUse = savedId || user.uid;
                    setActiveUserId(idToUse);
                    if (!savedId) {
                        localStorage.setItem(LOCAL_STORAGE_KEY, user.uid);
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
        const userDocRef = doc(db, `artifacts/${appIdPath}/users/${activeUserId}/data/general`);

        const unsubscribeSnapshot = onSnapshot(userDocRef, async (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data();
                const loadedTarjetas = data.tarjetas || [];
                setTarjetas(loadedTarjetas);
                setDeudas(data.deudas || []);
                 if (seleccion === null) {
                    setSeleccion(loadedTarjetas.length > 0 ? loadedTarjetas[0].nombre : "Deudas");
                }
            } else {
                if (activeUserId === authUserId && authUserId !== null) {
                    await setDoc(userDocRef, datosIniciales);
                    setTarjetas(datosIniciales.tarjetas);
                    setDeudas(datosIniciales.deudas);
                    setSeleccion(datosIniciales.tarjetas[0]?.nombre || "Deudas");
                } else {
                    setTarjetas([]);
                    setDeudas([]);
                    setSeleccion(null);
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


    const saveToFirebase = async (data) => {
        if (activeUserId && db) {
            const userDocRef = doc(db, `artifacts/${appIdPath}/users/${activeUserId}/data/general`);
            try {
                await setDoc(userDocRef, { tarjetas, deudas, ...data }, { merge: true });
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
        localStorage.setItem(LOCAL_STORAGE_KEY, authUserId);
        setActiveUserId(authUserId);
        setIdParaCargar('');
    };
    
    // --- Lógica de Selección Optimizada ---
    const { esVistaDeudas, tarjetaActiva, itemsActivos } = useMemo(() => {
        const esDeudas = seleccion === 'Deudas';
        const tarjeta = !esDeudas ? tarjetas.find(t => t.nombre === seleccion) : null;
        const items = esDeudas ? deudas : (tarjeta?.compras || []);
        return {
            esVistaDeudas: esDeudas,
            tarjetaActiva: tarjeta,
            itemsActivos: items
        };
    }, [seleccion, tarjetas, deudas]);


    const handleAgregarTarjeta = (e) => {
        e.preventDefault();
        if (!nuevaTarjeta.nombre || !nuevaTarjeta.limite || parseFloat(nuevaTarjeta.limite) <= 0) {
            return;
        }
        const tarjetaAGuardar = {
            nombre: nuevaTarjeta.nombre.trim(),
            limite: parseFloat(nuevaTarjeta.limite),
            saldo: parseFloat(nuevaTarjeta.limite),
            compras: [],
            mostrarSaldo: nuevaTarjeta.mostrarSaldo
        };
        const tarjetasActualizadas = [...tarjetas, tarjetaAGuardar];
        saveToFirebase({ tarjetas: tarjetasActualizadas });
        setMostrarFormularioTarjeta(false);
        setNuevaTarjeta({ nombre: '', limite: '', mostrarSaldo: true });
    }

    const guardarItem = (e) => {
        e.preventDefault();
        if (!nuevoItem.monto || !(parseFloat(nuevoItem.monto) > 0) || !nuevoItem.descripcion) return;

        const montoNum = parseFloat(nuevoItem.monto);
        const cuotasNum = Number.isInteger(parseInt(nuevoItem.cuotas)) && nuevoItem.cuotas > 0 ? parseInt(nuevoItem.cuotas) : 1;
        const cuotasPagadasNum = Number.isInteger(parseInt(cuotasPagadas)) ? parseInt(cuotasPagadas) : 0;
        const cuotasRestantesNum = Math.max(0, cuotasNum - cuotasPagadasNum);

        const itemFinal = {
            descripcion: nuevoItem.descripcion,
            categoria: nuevoItem.categoria,
            montoTotal: montoNum,
            cuotas: cuotasNum,
            montoCuota: cuotasNum > 0 ? montoNum / cuotasNum : montoNum,
            cuotasRestantes: cuotasRestantesNum,
            pagada: cuotasRestantesNum === 0,
            postergada: postergada,
        };

        if (esVistaDeudas) {
            let deudasActualizadas;
            if (itemEnEdicion !== null) {
                deudasActualizadas = deudas.map((d, i) => i === itemEnEdicion ? itemFinal : d);
            } else {
                deudasActualizadas = [...deudas, itemFinal];
            }
            saveToFirebase({ deudas: deudasActualizadas });
        } else if(tarjetaActiva) {
            const tarjetasActualizadas = tarjetas.map(t => {
                if (t.nombre === seleccion) {
                    let saldoActualizado = t.saldo;
                    let comprasActualizadas;

                    if (itemEnEdicion !== null) {
                        const compraOriginal = t.compras[itemEnEdicion];
                        saldoActualizado += compraOriginal.montoTotal;
                        comprasActualizadas = t.compras.map((c, i) => i === itemEnEdicion ? itemFinal : c);
                    } else {
                        comprasActualizadas = [...t.compras, itemFinal];
                    }
                    saldoActualizado -= itemFinal.montoTotal;
                    return { ...t, saldo: saldoActualizado, compras: comprasActualizadas };
                }
                return t;
            });
            saveToFirebase({ tarjetas: tarjetasActualizadas });
        }

        setNuevoItem({ descripcion: '', monto: '', cuotas: '', categoria: categoriasDisponibles[0] });
        setItemEnEdicion(null);
        setPostergada(false);
        setCuotasPagadas('');
    };


    const eliminarItem = (itemIndex) => {
        if(esVistaDeudas) {
            const deudasActualizadas = deudas.filter((_, i) => i !== itemIndex);
            saveToFirebase({ deudas: deudasActualizadas });
        } else if (tarjetaActiva) {
            const itemAEliminar = tarjetaActiva.compras[itemIndex];
            if (!itemAEliminar) return;
            const montoADevolver = itemAEliminar.montoTotal;

            const tarjetasActualizadas = tarjetas.map(t =>
                t.nombre === seleccion
                    ? { ...t,
                        saldo: t.saldo + montoADevolver,
                        compras: t.compras.filter((_, i) => i !== itemIndex)
                      }
                    : t
            );
            saveToFirebase({ tarjetas: tarjetasActualizadas });
        }
    };

    const iniciarEdicion = (itemIndex) => {
        const itemAEditar = itemsActivos[itemIndex];
        if (!itemAEditar) return;
        setNuevoItem({
            descripcion: itemAEditar.descripcion,
            monto: itemAEditar.montoTotal,
            cuotas: itemAEditar.cuotas,
            categoria: itemAEditar.categoria
        });
        setItemEnEdicion(itemIndex);
        setPostergada(itemAEditar.postergada || false);
        const pagadas = itemAEditar.cuotas - itemAEditar.cuotasRestantes;
        setCuotasPagadas(pagadas > 0 ? String(pagadas) : '');
         window.scrollTo(0, document.body.scrollHeight / 2);
    };

    const handleRecalcularSaldo = () => {
        if (!tarjetaActiva) return;
        const totalGastado = tarjetaActiva.compras.reduce((total, compra) => total + compra.montoTotal, 0);
        const saldoCorrecto = tarjetaActiva.limite - totalGastado;
        const tarjetasActualizadas = tarjetas.map(t =>
            t.nombre === seleccion ? { ...t, saldo: saldoCorrecto } : t
        );
        saveToFirebase({ tarjetas: tarjetasActualizadas });
    };

    const resumenGastos = itemsActivos.reduce((resumen, item) => {
        resumen[item.categoria] = (resumen[item.categoria] || 0) + item.montoTotal;
        return resumen;
    }, {});

    const handleCopyToClipboard = () => {
        if (!authUserId) return;
        const textArea = document.createElement("textarea");
        textArea.value = authUserId;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            setCopySuccess('¡ID Copiado!');
            setTimeout(() => setCopySuccess(''), 2000);
        } catch (err) {
            console.error('Error al copiar ID: ', err);
        }
        document.body.removeChild(textArea);
    };

    const resumenMes = useMemo(() => {
        if (!itemsActivos) return 0;
        return itemsActivos.reduce((total, item) => {
            if (item.cuotasRestantes > 0 && !item.postergada) {
                return total + parseFloat(item.montoCuota);
            }
            return total;
        }, 0);
    }, [itemsActivos]);

    const handlePagarResumen = () => {
        if (resumenMes <= 0) return;
        
        const procesarItems = (items) => {
            return items.map(item => {
                let updatedItem = { ...item };
                if (updatedItem.cuotasRestantes > 0 && !updatedItem.postergada) {
                    const nuevasCuotasRestantes = updatedItem.cuotasRestantes - 1;
                    updatedItem.cuotasRestantes = nuevasCuotasRestantes;
                    updatedItem.pagada = nuevasCuotasRestantes === 0;
                }
                if (updatedItem.postergada) {
                    updatedItem.postergada = false;
                }
                return updatedItem;
            });
        };

        if(esVistaDeudas) {
            const deudasActualizadas = procesarItems(deudas);
            saveToFirebase({ deudas: deudasActualizadas });
        } else if (tarjetaActiva) {
            const comprasDespuesDelPago = procesarItems(tarjetaActiva.compras);
            const tarjetasActualizadas = tarjetas.map(t => {
                if (t.nombre === seleccion) {
                    const nuevoSaldo = Math.min(t.limite, t.saldo + resumenMes);
                    return { ...t, saldo: nuevoSaldo, compras: comprasDespuesDelPago };
                }
                return t;
            });
            saveToFirebase({ tarjetas: tarjetasActualizadas });
        }
    };

    const handlePagarCuota = (itemIndex) => {
        const item = itemsActivos[itemIndex];
        if (!item || item.cuotasRestantes <= 0) return;

        const actualizarItem = (c, i) => {
            if (i === itemIndex) {
                const nuevasCuotasRestantes = c.cuotasRestantes - 1;
                return { ...c, cuotasRestantes: nuevasCuotasRestantes, pagada: nuevasCuotasRestantes === 0 };
            }
            return c;
        };
        
        if (esVistaDeudas) {
            const deudasActualizadas = deudas.map(actualizarItem);
            saveToFirebase({ deudas: deudasActualizadas });
        } else if (tarjetaActiva) {
            const tarjetasActualizadas = tarjetas.map(t => {
                if (t.nombre === seleccion) {
                    const nuevoSaldo = Math.min(t.limite, t.saldo + item.montoCuota);
                    const comprasActualizadas = t.compras.map(actualizarItem);
                    return { ...t, saldo: nuevoSaldo, compras: comprasActualizadas };
                }
                return t;
            });
            saveToFirebase({ tarjetas: tarjetasActualizadas });
        }
    };
    
    const resumenTotalGeneral = useMemo(() => {
        const calcularTotalMes = (items) => items.reduce((total, item) => {
            if (item.cuotasRestantes > 0 && !item.postergada) {
                return total + parseFloat(item.montoCuota);
            }
            return total;
        }, 0);

        const totalTarjetas = tarjetas.reduce((total, tarjeta) => total + calcularTotalMes(tarjeta.compras), 0);
        const totalDeudas = calcularTotalMes(deudas);
        
        return totalTarjetas + totalDeudas;
    }, [tarjetas, deudas]);

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
                Control de Gastos y Deudas 💸
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
                                <button onClick={handleResetToMyId} className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 transition font-semibold">Mi ID</button>
                            )}
                        </div>
                        {authUserId !== activeUserId && (
                            <p className="text-yellow-400 text-xs mt-2 text-center">
                                Estás viendo los datos de otro usuario. Los cambios se guardarán en ese ID.
                            </p>
                        )}
                    </div>
                </div>
            )}

            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8 border-t-4 border-teal-500">
                <h2 className="text-xl sm:text-2xl font-semibold mb-4 text-gray-300">
                    Seleccionar Tarjeta o Deudas
                </h2>
                <select
                    value={seleccion || ''}
                    onChange={(e) => setSeleccion(e.target.value)}
                    className="p-3 rounded-xl bg-gray-700 text-white w-full border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                >
                    {tarjetas.map(t => (
                        <option key={t.nombre} value={t.nombre}>{t.nombre}</option>
                    ))}
                    <option value="Deudas">Deudas</option>
                </select>
                <button
                    onClick={() => setMostrarFormularioTarjeta(true)}
                    className="w-full mt-4 bg-green-600 text-white font-bold p-3 rounded-xl hover:bg-green-700 transition"
                >
                    + Añadir Nueva Tarjeta
                </button>
                {mostrarFormularioTarjeta && (
                    <form onSubmit={handleAgregarTarjeta} className="mt-4 p-4 bg-gray-700 rounded-xl flex flex-col gap-3 border-t-2 border-green-500">
                        <h3 className="text-lg font-semibold text-gray-300">Nueva Tarjeta</h3>
                        <input type="text" placeholder="Nombre de la tarjeta" value={nuevaTarjeta.nombre} onChange={(e) => setNuevaTarjeta({ ...nuevaTarjeta, nombre: e.target.value })} className="p-2 rounded-md bg-gray-600 text-white border border-gray-500 focus:ring-green-500" required />
                        <input type="number" placeholder="Límite de la tarjeta" value={nuevaTarjeta.limite} onChange={(e) => setNuevaTarjeta({ ...nuevaTarjeta, limite: e.target.value })} className="p-2 rounded-md bg-gray-600 text-white border border-gray-500 focus:ring-green-500" required />
                         <div className="flex items-center gap-2 text-gray-300 mt-2">
                            <input type="checkbox" id="mostrar-saldo-checkbox" checked={nuevaTarjeta.mostrarSaldo} onChange={(e) => setNuevaTarjeta({ ...nuevaTarjeta, mostrarSaldo: e.target.checked })} />
                            <label htmlFor="mostrar-saldo-checkbox">Mostrar saldo por defecto</label>
                        </div>
                        <div className="flex gap-2 mt-2">
                            <button type="submit" className="flex-1 bg-green-600 text-white p-2 rounded-md hover:bg-green-700 font-semibold transition">Guardar</button>
                            <button type="button" onClick={() => setMostrarFormularioTarjeta(false)} className="flex-1 bg-red-500 text-white p-2 rounded-md hover:bg-red-600">Cancelar</button>
                        </div>
                    </form>
                )}
            </div>

            {seleccion && (
                <>
                    {!esVistaDeudas && tarjetaActiva && tarjetaActiva.mostrarSaldo && (
                        <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8 border-t-4 border-teal-500">
                            <div className="flex justify-between items-center mb-2">
                                <h2 className="text-xl sm:text-2xl font-semibold text-gray-300">Saldo de {tarjetaActiva.nombre}</h2>
                                <button onClick={handleRecalcularSaldo} title="Recalcular saldo si es incorrecto" className="bg-orange-600 text-white px-3 py-1 text-xs font-bold rounded-lg hover:bg-orange-700 transition">Recalcular</button>
                            </div>
                            <p className="text-3xl sm:text-4xl font-extrabold text-green-400">$ {tarjetaActiva.saldo.toLocaleString('es-AR')}</p>
                            <p className="text-sm sm:text-lg text-gray-400 mt-1">Límite: $ {tarjetaActiva.limite.toLocaleString('es-AR')}</p>
                        </div>
                    )}

                    <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8 border-t-4 border-blue-500">
                        <h2 className="text-xl sm:text-2xl font-semibold mb-2 text-gray-300">
                            Resumen del Mes ({seleccion})
                        </h2>
                        <p className="text-3xl sm:text-4xl font-extrabold text-blue-400">$ {resumenMes.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        <button onClick={handlePagarResumen} disabled={resumenMes <= 0} className="w-full mt-4 bg-blue-600 text-white font-bold p-3 rounded-xl hover:bg-blue-700 transition duration-300 ease-in-out shadow-md disabled:bg-gray-500 disabled:cursor-not-allowed">Pagar Resumen</button>
                    </div>

                    <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8 border-t-4 border-purple-500">
                        <h2 className="text-xl sm:text-2xl font-semibold mb-2 text-gray-300">
                            Resumen Total General
                        </h2>
                        <p className="text-3xl sm:text-4xl font-extrabold text-purple-400">
                            $ {resumenTotalGeneral.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                    </div>

                    <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8">
                        <h2 className="text-xl sm:text-2xl font-semibold mb-4 text-gray-300">
                            {itemEnEdicion !== null ? 'Editar' : 'Añadir'} {esVistaDeudas ? 'Deuda' : 'Compra'}
                        </h2>
                        <form onSubmit={guardarItem} className="flex flex-col gap-4">
                            <input type="text" placeholder="Descripción" value={nuevoItem.descripcion} onChange={(e) => setNuevoItem({ ...nuevoItem, descripcion: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition" required />
                            <input type="number" placeholder="Monto total" value={nuevoItem.monto} onChange={(e) => setNuevoItem({ ...nuevoItem, monto: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition" required />
                            <input type="number" placeholder="Número de cuotas (ej: 6)" value={nuevoItem.cuotas} onChange={(e) => setNuevoItem({ ...nuevoItem, cuotas: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition" />
                            <input type="number" placeholder="Cuotas ya pagadas (ej: 2)" value={cuotasPagadas} onChange={(e) => setCuotasPagadas(e.target.value)} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition" />
                            <select value={nuevoItem.categoria} onChange={(e) => setNuevoItem({ ...nuevoItem, categoria: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white w-full border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition">
                                {categoriasDisponibles.map(cat => (<option key={cat} value={cat}>{cat}</option>))}
                            </select>
                            <div className="flex items-center gap-2 text-gray-300">
                                <input type="checkbox" id="postergada-checkbox" checked={postergada} onChange={(e) => setPostergada(e.target.checked)} className="h-4 w-4 rounded bg-gray-700 border-gray-600 text-teal-500 focus:ring-teal-500" />
                                <label htmlFor="postergada-checkbox">Pagar en el próximo resumen</label>
                            </div>
                            <button type="submit" className="bg-teal-600 text-white font-bold p-3 rounded-xl hover:bg-teal-700 transition duration-300 ease-in-out shadow-md">
                                {itemEnEdicion !== null ? 'Guardar Cambios' : `Añadir ${esVistaDeudas ? 'Deuda' : 'Compra'}`}
                            </button>
                        </form>
                    </div>
                    
                    <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mt-8 border-t-4 border-teal-500">
                        <h2 className="text-xl sm:text-2xl font-semibold mb-4 text-gray-300">Listado de {seleccion}</h2>
                        {itemsActivos.length > 0 ? (
                            <ul className="space-y-4">
                                {itemsActivos.map((item, index) => (
                                    <li key={index} className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-700 p-4 rounded-xl border border-gray-600 gap-3">
                                        <div className={item.pagada ? 'opacity-50' : ''}>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="font-bold text-lg">{item.descripcion}</p>
                                                {item.pagada && <span className="text-xs font-bold text-white bg-green-600 px-2 py-1 rounded-full">PAGADA</span>}
                                                {item.postergada && <span className="text-xs font-bold text-black bg-yellow-400 px-2 py-1 rounded-full">POSTERGADA</span>}
                                            </div>
                                            <p className="text-sm text-gray-400">{item.categoria}</p>
                                            <p className="text-base text-gray-200">Total: $ {item.montoTotal.toLocaleString('es-AR')} ({item.cuotas} cuotas)</p>
                                            <p className="text-base text-cyan-400">Valor cuota: $ {item.montoCuota.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                            <p className="text-sm text-gray-400 italic mt-1">Cuotas restantes: {item.cuotasRestantes}</p>
                                        </div>
                                        <div className="flex flex-row sm:flex-col space-x-2 sm:space-x-0 sm:space-y-2 w-full sm:w-auto justify-end">
                                            {item.cuotasRestantes > 0 && (
                                                <button onClick={() => handlePagarCuota(index)} className="bg-green-600 p-2 rounded-xl hover:bg-green-700 text-sm transition font-medium">Pagar Cuota</button>
                                            )}
                                            <button onClick={() => iniciarEdicion(index)} className="bg-yellow-500 p-2 rounded-xl hover:bg-yellow-600 text-sm transition font-medium disabled:opacity-50" disabled={item.pagada}>Editar</button>
                                            <button onClick={() => eliminarItem(index)} className="bg-red-600 p-2 rounded-xl hover:bg-red-700 text-sm transition font-medium">Eliminar</button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        ) : (<p className="text-gray-400 text-sm italic">No hay items registrados.</p>)}
                    </div>
                </>
            )}
        </main>
    );
}

export default function HomePage() {
    return <AuthWrapper />;
}

