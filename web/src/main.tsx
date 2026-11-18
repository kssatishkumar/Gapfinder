import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './styles/organic.css';
import './styles/app.css';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { GapFinder } from './pages/GapFinder';
import { Mentors } from './pages/Mentors';
import { Tips } from './pages/Tips';
import { Admin } from './pages/Admin';
import { NotFound } from './pages/NotFound';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="gapfinder" element={<GapFinder />} />
          <Route path="mentors" element={<Mentors />} />
          <Route path="tips/:tipId?" element={<Tips />} />
          <Route path="admin" element={<Admin />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
