import MusicNetwork from './MusicNetwork.jsx'

// La mappa occupa tutto lo schermo; nessuna prop da passare:
// MusicNetwork fa da solo il fetch di graph.json e mostra un loader.
export default function App() {
  return <MusicNetwork />
}
