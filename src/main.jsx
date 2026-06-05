import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Niente StrictMode: la mappa monta una simulazione d3 con stato proprio,
// e il doppio mount in dev di StrictMode rieseguirebbe la force simulation
// (e il fetch di graph.json) due volte. In produzione StrictMode non agisce,
// quindi lo omettiamo per avere dev e prod identici.
ReactDOM.createRoot(document.getElementById('root')).render(<App />)
