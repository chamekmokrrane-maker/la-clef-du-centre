import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import './styles.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function createSupabaseSafeClient() {
  try {
    const url = String(SUPABASE_URL || '').trim();
    const key = String(SUPABASE_KEY || '').trim();
    if (!url || !key || url.includes('TON-PROJET') || key.includes('TA_CLE')) return null;
    return createClient(url, key);
  } catch (error) {
    console.error('Configuration Supabase invalide', error);
    return null;
  }
}

const supabase = createSupabaseSafeClient();

const LOCAL_KEY = 'la_clef_du_centre_facturation_v3';
const AUTH_SESSION_KEY = 'la_clef_auth_session_v1';
const LOCAL_USERS_KEY = 'la_clef_local_users_v1';
const OLD_LOCAL_KEYS = ['la_clef_du_centre_facturation_v2', 'la_clef_du_centre_facturation_v1'];
const DEFAULT_CONDITIONS = `• 40% à la signature du devis.\n• 30% en cours des travaux.\n• 30% en fin des travaux.`;
const DEFAULT_COMPANY = {
  name: 'LA CLEF DU CENTRE',
  address: '4 Pl. du Général Leclerc, 93380 Saint-Denis',
  phone1: '07-82-93-43-27',
  phone2: '06-26-54-41-79',
  email: '',
  siret: '',
  tva: '',
  logoDataUrl: ''
};

function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-');
}

function getStoredSession() {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.user?.username) return null;
    return parsed;
  } catch {
    return null;
  }
}

function storeSession(user) {
  const session = { user, connectedAt: new Date().toISOString() };
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  return session;
}

function clearSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getLocalUsers() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || '[]');
  } catch {
    return [];
  }
}

function setLocalUsers(users) {
  localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
}

async function appHasUsers() {
  if (supabase) {
    const { data, error } = await supabase.rpc('la_clef_has_users');
    if (!error) return Boolean(data);
    console.warn('Vérification comptes Supabase impossible, bascule locale', error);
  }
  return getLocalUsers().length > 0;
}

async function createFirstAdminAccount({ username, password, displayName }) {
  const cleanUsername = normalizeUsername(username);
  const cleanName = String(displayName || username || '').trim() || cleanUsername;
  if (!cleanUsername) throw new Error('Identifiant obligatoire.');
  if (String(password || '').length < 4) throw new Error('Le mot de passe doit contenir au minimum 4 caractères.');

  if (supabase) {
    const { data, error } = await supabase.rpc('la_clef_create_first_admin', {
      p_username: cleanUsername,
      p_password: password,
      p_display_name: cleanName
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Création du compte impossible.');
    return { id: row.id, username: row.username, displayName: row.display_name || cleanName, role: row.role || 'admin' };
  }

  const users = getLocalUsers();
  if (users.length > 0) throw new Error('Un compte existe déjà. Connecte-toi avec ce compte.');
  const passwordHash = await sha256(password);
  const user = { id: makeId(), username: cleanUsername, displayName: cleanName, role: 'admin', passwordHash, active: true };
  setLocalUsers([user]);
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
}

async function loginAccount({ username, password }) {
  const cleanUsername = normalizeUsername(username);
  if (!cleanUsername || !password) throw new Error('Identifiant et mot de passe obligatoires.');

  if (supabase) {
    const { data, error } = await supabase.rpc('la_clef_login', {
      p_username: cleanUsername,
      p_password: password
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Identifiant ou mot de passe incorrect.');
    return { id: row.id, username: row.username, displayName: row.display_name || row.username, role: row.role || 'admin' };
  }

  const passwordHash = await sha256(password);
  const user = getLocalUsers().find((item) => item.username === cleanUsername && item.passwordHash === passwordHash && item.active !== false);
  if (!user) throw new Error('Identifiant ou mot de passe incorrect.');
  return { id: user.id, username: user.username, displayName: user.displayName || user.username, role: user.role || 'admin' };
}

async function adminCreateAccount({ adminUsername, adminPassword, username, password, displayName, role }) {
  const cleanUsername = normalizeUsername(username);
  const cleanAdmin = normalizeUsername(adminUsername);
  const cleanName = String(displayName || username || '').trim() || cleanUsername;
  const finalRole = role === 'utilisateur' ? 'utilisateur' : 'admin';
  if (!cleanUsername) throw new Error('Identifiant du nouveau compte obligatoire.');
  if (String(password || '').length < 4) throw new Error('Le mot de passe doit contenir au minimum 4 caractères.');
  if (!adminPassword) throw new Error('Entre le mot de passe admin pour confirmer la création.');

  if (supabase) {
    const { data, error } = await supabase.rpc('la_clef_admin_create_user', {
      p_admin_username: cleanAdmin,
      p_admin_password: adminPassword,
      p_username: cleanUsername,
      p_password: password,
      p_display_name: cleanName,
      p_role: finalRole
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Création du compte impossible.');
    return row;
  }

  const users = getLocalUsers();
  const adminHash = await sha256(adminPassword);
  const admin = users.find((item) => item.username === cleanAdmin && item.passwordHash === adminHash && item.role === 'admin' && item.active !== false);
  if (!admin) throw new Error('Mot de passe admin incorrect.');
  if (users.some((item) => item.username === cleanUsername)) throw new Error('Cet identifiant existe déjà.');
  const passwordHash = await sha256(password);
  const user = { id: makeId(), username: cleanUsername, displayName: cleanName, role: finalRole, passwordHash, active: true };
  setLocalUsers([...users, user]);
  return user;
}

function tableFor(type) {
  return type === 'devis' ? 'la_clef_devis' : 'la_clef_factures';
}

function makeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function money(value) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
}

function safeNumber(value) {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function createLine() {
  return {
    id: makeId(),
    description: '',
    quantity: 1,
    unitHt: 0
  };
}

function createIntervention(index = 1) {
  return {
    id: makeId(),
    description: '',
    title: `Intervention ${index}`,
    lines: [createLine()]
  };
}

function createDraftDocument(type, numero, company) {
  return {
    id: makeId(),
    type,
    numero,
    date: todayISO(),
    client: {
      name: '',
      address: '',
      phone: '',
      email: ''
    },
    companySnapshot: { ...company },
    interventions: [createIntervention(1)],
    conditions: DEFAULT_CONDITIONS,
    tvaRate: 10,
    notes: '',
    status: 'brouillon',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizeDocument(doc, company = DEFAULT_COMPANY, forcedType = null) {
  const base = doc || {};
  const type = forcedType || (base.type === 'devis' ? 'devis' : 'facture');
  const normalizedInterventions = (base.interventions?.length ? base.interventions : [createIntervention(1)]).map((intervention, index) => ({
    id: intervention.id || makeId(),
    description: intervention.description ?? intervention.details ?? '',
    title: intervention.title || `Intervention ${index + 1}`,
    lines: (intervention.lines?.length ? intervention.lines : [createLine()]).map((line) => ({
      id: line.id || makeId(),
      description: line.description ?? line.designation ?? '',
      quantity: line.quantity ?? 1,
      unitHt: line.unitHt ?? 0
    }))
  }));

  return {
    id: base.id || makeId(),
    type,
    numero: base.numero || '',
    date: base.date || todayISO(),
    client: {
      name: base.client?.name || '',
      address: base.client?.address || '',
      phone: base.client?.phone || '',
      email: base.client?.email || ''
    },
    companySnapshot: { ...company, ...(base.companySnapshot || {}) },
    interventions: normalizedInterventions,
    conditions: base.conditions ?? DEFAULT_CONDITIONS,
    tvaRate: base.tvaRate ?? 10,
    notes: base.notes || '',
    status: base.status || 'brouillon',
    createdAt: base.createdAt || new Date().toISOString(),
    updatedAt: base.updatedAt || new Date().toISOString()
  };
}

function getLocalState() {
  try {
    const keys = [LOCAL_KEY, ...OLD_LOCAL_KEYS];
    const raw = keys.map((key) => localStorage.getItem(key)).find(Boolean);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        company: { ...DEFAULT_COMPANY, ...(parsed.company || {}) },
        factures: (parsed.factures || parsed.documents?.filter((doc) => doc.type !== 'devis') || [])
          .map((doc) => normalizeDocument(doc, parsed.company || DEFAULT_COMPANY, 'facture')),
        devis: (parsed.devis || parsed.documents?.filter((doc) => doc.type === 'devis') || [])
          .map((doc) => normalizeDocument(doc, parsed.company || DEFAULT_COMPANY, 'devis')),
        counters: parsed.counters || { facture: 0, devis: 0 }
      };
    }
  } catch (error) {
    console.warn('Lecture locale impossible', error);
  }
  return {
    company: DEFAULT_COMPANY,
    factures: [],
    devis: [],
    counters: { facture: 0, devis: 0 }
  };
}

function setLocalState(next) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
}

function mergeLocal(updates) {
  const localState = getLocalState();
  setLocalState({ ...localState, ...updates });
}

async function loadCompany() {
  const localState = getLocalState();
  if (!supabase) return localState.company || DEFAULT_COMPANY;

  const { data, error } = await supabase
    .from('la_clef_company_settings')
    .select('data')
    .eq('id', 'default')
    .maybeSingle();

  if (error) {
    console.warn('Supabase paramètres entreprise', error);
    return localState.company || DEFAULT_COMPANY;
  }
  return data?.data ? { ...DEFAULT_COMPANY, ...data.data } : (localState.company || DEFAULT_COMPANY);
}

async function saveCompany(company) {
  mergeLocal({ company });

  if (!supabase) return;
  const { error } = await supabase
    .from('la_clef_company_settings')
    .upsert({ id: 'default', data: company, updated_at: new Date().toISOString() });
  if (error) throw error;
}

async function loadDocumentsByType(type, company = DEFAULT_COMPANY) {
  const localState = getLocalState();
  const localDocs = type === 'devis' ? localState.devis : localState.factures;
  if (!supabase) return localDocs || [];

  const { data, error } = await supabase
    .from(tableFor(type))
    .select('id, numero, data, created_at, updated_at')
    .order('updated_at', { ascending: false });

  if (error) {
    console.warn(`Supabase ${type}`, error);
    return localDocs || [];
  }
  return (data || []).map((row) => normalizeDocument({
    ...row.data,
    id: row.id,
    type,
    numero: row.numero
  }, company, type));
}

async function loadAllDocuments(company = DEFAULT_COMPANY) {
  const [factures, devis] = await Promise.all([
    loadDocumentsByType('facture', company),
    loadDocumentsByType('devis', company)
  ]);
  mergeLocal({ factures, devis });
  return { factures, devis };
}

async function nextNumber(type) {
  const prefix = type === 'facture' ? 'FA' : 'DV';

  if (supabase) {
    const { data, error } = await supabase.rpc('la_clef_next_document_number', { p_doc_type: type });
    if (!error && data) return data;
    console.warn('Génération numéro Supabase impossible, bascule locale', error);
  }

  const localState = getLocalState();
  const current = safeNumber(localState.counters?.[type]);
  const next = current + 1;
  const counters = { ...(localState.counters || {}), [type]: next };
  setLocalState({ ...localState, counters });
  return `${prefix}-${String(next).padStart(6, '0')}`;
}

async function upsertDocument(document) {
  const normalized = normalizeDocument({ ...document, updatedAt: new Date().toISOString() }, document.companySnapshot || DEFAULT_COMPANY, document.type);
  const localState = getLocalState();
  const listKey = normalized.type === 'devis' ? 'devis' : 'factures';
  const currentList = localState[listKey] || [];
  const exists = currentList.some((d) => d.id === normalized.id);
  const nextList = exists
    ? currentList.map((d) => (d.id === normalized.id ? normalized : d))
    : [normalized, ...currentList];
  setLocalState({ ...localState, [listKey]: nextList });

  if (!supabase) return normalized;

  const { error } = await supabase
    .from(tableFor(normalized.type))
    .upsert({
      id: normalized.id,
      numero: normalized.numero,
      data: normalized,
      updated_at: new Date().toISOString()
    });

  if (error) throw error;
  return normalized;
}

async function removeDocument(type, documentId) {
  const localState = getLocalState();
  const listKey = type === 'devis' ? 'devis' : 'factures';
  setLocalState({
    ...localState,
    [listKey]: (localState[listKey] || []).filter((d) => d.id !== documentId)
  });

  if (!supabase) return;
  const { error } = await supabase.from(tableFor(type)).delete().eq('id', documentId);
  if (error) throw error;
}

function calculateLine(line) {
  return safeNumber(line.quantity) * safeNumber(line.unitHt);
}

function calculateIntervention(intervention) {
  return (intervention.lines || []).reduce((sum, line) => sum + calculateLine(line), 0);
}

function calculateTotals(document) {
  const totalHt = (document.interventions || []).reduce((sum, intervention) => sum + calculateIntervention(intervention), 0);
  const tvaRate = safeNumber(document.tvaRate);
  const tva = totalHt * (tvaRate / 100);
  const totalTtc = totalHt + tva;
  return { totalHt, tvaRate, tva, totalTtc };
}

function formatDateFr(date) {
  if (!date) return '';
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function labelForType(type) {
  return type === 'devis' ? 'Devis' : 'Facture';
}

function cleanFileName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'document';
}

function documentFileName(currentDocument) {
  const typeLabel = currentDocument.type === 'devis' ? 'devis' : 'facture';
  const number = cleanFileName(currentDocument.numero || typeLabel);
  const client = cleanFileName(currentDocument.client?.name || 'client');
  return `${typeLabel}-${number}-${client}.pdf`;
}

function normalizeWhatsappPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('33')) return digits;
  if (digits.startsWith('0')) return `33${digits.slice(1)}`;
  return digits;
}

function buildWhatsappMessage(currentDocument) {
  const totals = calculateTotals(currentDocument);
  const title = labelForType(currentDocument.type).toLowerCase();
  const clientName = currentDocument.client?.name || 'Madame, Monsieur';
  const company = currentDocument.companySnapshot || DEFAULT_COMPANY;

  const details = (currentDocument.interventions || [])
    .map((intervention, index) => {
      const lines = (intervention.lines || [])
        .filter((line) => line.description || safeNumber(line.unitHt) || safeNumber(line.quantity))
        .map((line) => `- ${line.description || 'Intervention'} : ${safeNumber(line.quantity)} x ${money(line.unitHt)} = ${money(calculateLine(line))}`)
        .join('\n');
      return `${index + 1}. ${intervention.title || `Intervention ${index + 1}`}\n${lines}`;
    })
    .join('\n\n');

  return `Bonjour ${clientName},\n\nVoici votre ${title} n° ${currentDocument.numero} du ${formatDateFr(currentDocument.date)}.\n\n${details}\n\nTotal HT : ${money(totals.totalHt)}\nTVA ${totals.tvaRate}% : ${money(totals.tva)}\nTotal TTC : ${money(totals.totalTtc)}\n\nCordialement,\n${company.name}\n${[company.phone1, company.phone2].filter(Boolean).join(' / ')}`;
}

function openWhatsappForDocument(currentDocument) {
  const text = encodeURIComponent(buildWhatsappMessage(currentDocument));
  const phone = normalizeWhatsappPhone(currentDocument.client?.phone);
  const url = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function pdfText(pdf, text, x, y, options = {}) {
  const value = String(text || '');
  pdf.text(value, x, y, options);
}

async function imageToDataUrl(src) {
  if (!src) return '';
  if (src.startsWith('data:')) return src;
  const response = await fetch(src);
  if (!response.ok) return '';
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function downloadDocumentPdf(currentDocument) {
  const module = await import('jspdf');
  const JsPDF = module.jsPDF || module.default?.jsPDF || module.default || module;
  const pdf = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });

  const company = currentDocument.companySnapshot || DEFAULT_COMPANY;
  const totals = calculateTotals(currentDocument);
  const title = labelForType(currentDocument.type).toUpperCase();
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 10;
  const contentWidth = pageWidth - margin * 2;
  const bottomLimit = pageHeight - 18;
  const blueDark = [5, 22, 62];
  const blue = [16, 65, 185];
  const gold = [177, 128, 35];
  const lightBlue = [239, 246, 255];
  const lightGold = [255, 247, 230];
  const border = [196, 208, 224];
  const text = [17, 24, 39];

  let logoDataUrl = '';
  try {
    logoDataUrl = await imageToDataUrl(company.logoDataUrl || '/logo.png');
  } catch (error) {
    console.warn('Logo PDF non chargé', error);
  }

  function setFill(rgb) { pdf.setFillColor(rgb[0], rgb[1], rgb[2]); }
  function setDraw(rgb) { pdf.setDrawColor(rgb[0], rgb[1], rgb[2]); }
  function setTxt(rgb) { pdf.setTextColor(rgb[0], rgb[1], rgb[2]); }

  function lineText(value, x, y, maxWidth, fontSize = 8, style = 'normal') {
    pdf.setFont('helvetica', style);
    pdf.setFontSize(fontSize);
    setTxt(text);
    const lines = pdf.splitTextToSize(String(value || ''), maxWidth);
    pdf.text(lines, x, y);
    return lines.length * (fontSize * 0.36 + 1.1);
  }

  function drawFooter() {
    const pageNumber = pdf.internal.getCurrentPageInfo().pageNumber;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    setTxt([100, 116, 139]);
    pdf.text(`${title} ${currentDocument.numero || ''} - Page ${pageNumber}`, margin, pageHeight - 8);
  }

  function drawCompactHeader() {
    setFill(blueDark);
    pdf.rect(0, 0, pageWidth, 6, 'F');
    setTxt(blueDark);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text(company.name || 'LA CLEF DU CENTRE', margin, 16);
    pdf.setFontSize(9);
    pdf.text(`${title} ${currentDocument.numero || ''}`, pageWidth - margin, 16, { align: 'right' });
    setDraw(border);
    pdf.line(margin, 20, pageWidth - margin, 20);
    return 28;
  }

  function newPage() {
    drawFooter();
    pdf.addPage();
    return drawCompactHeader();
  }

  function ensureSpace(y, needed) {
    if (y + needed > bottomLimit) return newPage();
    return y;
  }

  function drawFirstHeader() {
    setFill(blueDark);
    pdf.rect(0, 0, pageWidth, 8, 'F');
    setFill(blue);
    pdf.rect(0, 8, pageWidth, 2.2, 'F');
    setFill(gold);
    pdf.rect(pageWidth - 62, 10.2, 52, 1.6, 'F');

    setDraw(border);
    pdf.roundedRect(margin, 18, 44, 24, 2, 2);
    if (logoDataUrl) {
      try {
        const logoType = logoDataUrl.toLowerCase().includes('image/jpeg') || logoDataUrl.toLowerCase().includes('image/jpg') ? 'JPEG' : 'PNG';
        pdf.addImage(logoDataUrl, logoType, margin + 2, 20, 40, 18, undefined, 'FAST');
      } catch (error) {
        console.warn('Insertion logo PDF impossible', error);
      }
    }

    setTxt(blueDark);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.text(company.name || 'LA CLEF DU CENTRE', margin + 50, 24);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.2);
    setTxt([51, 65, 85]);
    const companyLines = [
      company.address,
      [company.phone1, company.phone2].filter(Boolean).join(' / '),
      company.email,
      company.siret ? `SIRET : ${company.siret}` : '',
      company.tva ? `TVA : ${company.tva}` : ''
    ].filter(Boolean);
    pdf.text(companyLines, margin + 50, 29);

    setFill(lightBlue);
    setDraw(border);
    pdf.roundedRect(pageWidth - margin - 48, 18, 48, 33, 2, 2, 'FD');
    setTxt(blueDark);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.text(title, pageWidth - margin - 44, 28);
    pdf.setFontSize(8);
    setTxt([71, 85, 105]);
    pdf.text('N°', pageWidth - margin - 44, 38);
    pdf.text('DATE', pageWidth - margin - 44, 46);
    setTxt(text);
    pdf.text(currentDocument.numero || '', pageWidth - margin - 4, 38, { align: 'right' });
    pdf.text(formatDateFr(currentDocument.date), pageWidth - margin - 4, 46, { align: 'right' });

    return 62;
  }

  function drawAddresses(y) {
    const boxW = (contentWidth - 8) / 2;
    const boxH = 30;
    setDraw(border);
    setFill([248, 251, 255]);
    pdf.roundedRect(margin, y, boxW, boxH, 2, 2, 'FD');
    setFill([255, 253, 248]);
    pdf.roundedRect(margin + boxW + 8, y, boxW, boxH, 2, 2, 'FD');
    setFill(blue);
    pdf.rect(margin, y, 1.8, boxH, 'F');
    setFill(gold);
    pdf.rect(margin + boxW + 8, y, 1.8, boxH, 'F');

    setTxt(blueDark);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.8);
    pdf.text('ÉMETTEUR', margin + 4, y + 6);
    pdf.text('CLIENT', margin + boxW + 12, y + 6);

    lineText(company.name || '', margin + 4, y + 11, boxW - 8, 8.5, 'bold');
    lineText([company.address, company.phone1 ? `Tél : ${company.phone1}` : '', company.phone2 ? `Tél : ${company.phone2}` : '', company.email ? `Email : ${company.email}` : ''].filter(Boolean).join('\n'), margin + 4, y + 16, boxW - 8, 7.2);

    const client = currentDocument.client || {};
    lineText(client.name || 'Nom du client', margin + boxW + 12, y + 11, boxW - 8, 8.5, 'bold');
    lineText([client.address || 'Adresse du client', client.phone ? `Tél : ${client.phone}` : '', client.email ? `Email : ${client.email}` : ''].filter(Boolean).join('\n'), margin + boxW + 12, y + 16, boxW - 8, 7.2);
    return y + boxH + 8;
  }

  function drawTableHeader(y) {
    const widths = [105, 22, 31, 32];
    setFill(blueDark);
    setDraw(blueDark);
    pdf.rect(margin, y, contentWidth, 9, 'FD');
    setTxt([255, 255, 255]);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    const headers = ['Description', 'Quantité', 'Prix unitaire HT', 'Prix HT'];
    let x = margin;
    headers.forEach((header, index) => {
      if (index === 0) {
        pdf.text(header, x + 2, y + 5.8);
      } else {
        pdf.text(header, x + widths[index] - 2, y + 5.8, { align: 'right' });
      }
      x += widths[index];
    });
    setDraw([214, 226, 241]);
    x = margin + widths[0];
    widths.slice(1).forEach((w) => { pdf.line(x, y, x, y + 9); x += w; });
    return y + 9;
  }

  function drawRow(y, cells, opts = {}) {
    const widths = [105, 22, 31, 32];
    const padding = 2;
    const fontSize = opts.fontSize || 7.6;
    pdf.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    pdf.setFontSize(fontSize);
    const split = cells.map((cell, index) => pdf.splitTextToSize(String(cell ?? ''), widths[index] - padding * 2));
    const rowHeight = Math.max(opts.minHeight || 8, ...split.map((lines) => lines.length * (fontSize * 0.36 + 1.2) + 4));
    y = ensureSpace(y, rowHeight);
    if (opts.repeatHeader) y = drawTableHeader(y);
    setDraw(border);
    setFill(opts.fill || [255, 255, 255]);
    pdf.rect(margin, y, contentWidth, rowHeight, 'FD');
    let x = margin;
    widths.forEach((w, index) => {
      if (index > 0) pdf.line(x, y, x, y + rowHeight);
      setTxt(opts.textColor || text);
      const alignRight = index > 0;
      pdf.text(split[index], alignRight ? x + w - padding : x + padding, y + 5, { align: alignRight ? 'right' : 'left' });
      x += w;
    });
    return y + rowHeight;
  }

  function drawFullWidthRow(y, content, opts = {}) {
    const fontSize = opts.fontSize || 7.8;
    pdf.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    pdf.setFontSize(fontSize);
    const lines = pdf.splitTextToSize(String(content || ''), contentWidth - 4);
    const rowHeight = Math.max(opts.minHeight || 8, lines.length * (fontSize * 0.36 + 1.2) + 4);
    y = ensureSpace(y, rowHeight);
    setDraw(border);
    setFill(opts.fill || [255, 255, 255]);
    pdf.rect(margin, y, contentWidth, rowHeight, 'FD');
    setTxt(opts.textColor || text);
    pdf.text(lines, margin + 2, y + 5);
    return y + rowHeight;
  }

  function drawTotalsAndConditions(y) {
    const conditionsText = currentDocument.conditions || '';
    const notesText = currentDocument.notes ? `\nNotes :\n${currentDocument.notes}` : '';
    const leftW = 115;
    const rightW = 62;
    const condLines = pdf.splitTextToSize(`CONDITIONS DE RÈGLEMENT\n${conditionsText}${notesText}`, leftW - 4);
    const needed = Math.max(42, condLines.length * 4.1 + 7);
    y = ensureSpace(y + 4, needed);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    setTxt(blueDark);
    pdf.text('CONDITIONS DE RÈGLEMENT', margin, y + 5);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.4);
    setTxt(text);
    const detailLines = pdf.splitTextToSize(`${conditionsText}${notesText}`, leftW - 4);
    pdf.text(detailLines, margin, y + 10);

    const x = pageWidth - margin - rightW;
    const rows = [
      ['Total H.T', money(totals.totalHt)],
      [`T.V.A ${totals.tvaRate}%`, money(totals.tva)],
      ['Total T.T.C', money(totals.totalTtc)]
    ];
    rows.forEach((row, index) => {
      const h = index === 2 ? 10 : 8;
      setDraw(border);
      setFill(index === 2 ? blueDark : [255, 255, 255]);
      pdf.rect(x, y + index * 8, rightW, h, 'FD');
      setTxt(index === 2 ? [255, 255, 255] : text);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(index === 2 ? 8.3 : 7.7);
      pdf.text(row[0], x + 3, y + index * 8 + 5.3);
      pdf.text(row[1], x + rightW - 3, y + index * 8 + 5.3, { align: 'right' });
    });
    return y + needed;
  }

  let y = drawFirstHeader();
  y = drawAddresses(y);
  y = drawTableHeader(y);

  (currentDocument.interventions || []).forEach((intervention, index) => {
    y = drawFullWidthRow(y, `DESCRIPTION ${index + 1}\n${intervention.description || 'Description générale de la partie'}`, { fill: lightBlue, textColor: blueDark, bold: true, minHeight: 9 });
    y = drawFullWidthRow(y, intervention.title || `Intervention ${index + 1}`, { fill: lightGold, textColor: [122, 76, 0], bold: true, minHeight: 8 });
    (intervention.lines || []).forEach((line) => {
      y = drawRow(y, [line.description || 'Détail de l’intervention', safeNumber(line.quantity), money(line.unitHt), money(calculateLine(line))]);
    });
    y = drawRow(y, [`Sous-total ${intervention.title || `intervention ${index + 1}`}`, '', '', money(calculateIntervention(intervention))], { fill: [248, 250, 252], bold: true, minHeight: 8 });
  });

  y = drawTotalsAndConditions(y);
  drawFooter();
  pdf.save(documentFileName(currentDocument));
}


function AuthGate({ needsSetup, onAuthenticated }) {
  const [mode, setMode] = useState(needsSetup ? 'setup' : 'login');
  const [form, setForm] = useState({ username: '', displayName: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setMode(needsSetup ? 'setup' : 'login');
  }, [needsSetup]);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const user = mode === 'setup'
        ? await createFirstAdminAccount(form)
        : await loginAccount(form);
      storeSession(user);
      onAuthenticated(user);
    } catch (error) {
      setMessage(error.message || 'Connexion impossible.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">
          <img src="/logo.png" alt="Logo" />
          <div>
            <h1>LA CLEF DU CENTRE</h1>
            <p>{mode === 'setup' ? 'Création du premier compte administrateur' : 'Connexion au logiciel de facturation'}</p>
          </div>
        </div>

        <form onSubmit={submit} className="auth-form">
          <label>Identifiant
            <input value={form.username} onChange={(e) => update('username', e.target.value)} placeholder="ex : mokrane" autoComplete="username" />
          </label>
          {mode === 'setup' && (
            <label>Nom affiché
              <input value={form.displayName} onChange={(e) => update('displayName', e.target.value)} placeholder="ex : Mokrane" />
            </label>
          )}
          <label>Mot de passe
            <input type="password" value={form.password} onChange={(e) => update('password', e.target.value)} placeholder="Mot de passe" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </label>

          {message && <div className="auth-error">{message}</div>}
          <button className="primary auth-submit" type="submit" disabled={loading}>{loading ? 'Patiente...' : (mode === 'setup' ? 'Créer le compte admin' : 'Se connecter')}</button>
        </form>

        <p className="auth-help">
          {mode === 'setup'
            ? 'Ce premier compte restera connecté après actualisation du site. Tu pourras ensuite créer d’autres comptes depuis le module Entreprise.'
            : 'Après connexion, l’actualisation de la page ne déconnecte pas le compte.'}
        </p>
      </section>
    </main>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Erreur application', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="auth-screen">
          <section className="auth-card">
            <h1>Erreur de chargement</h1>
            <p>Le site a rencontré une erreur au démarrage. Vérifie les variables Supabase dans Render puis relance le déploiement.</p>
            <div className="auth-error">{this.state.error.message}</div>
            <button onClick={() => window.location.reload()}>Recharger</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

function Header({ view, setView, syncStatus, appUser, onLogout }) {
  return (
    <header className="topbar no-print">
      <div className="brand-mini">
        <img src="/logo.png" alt="Logo" />
        <div>
          <h1>LA CLEF DU CENTRE</h1>
          <p>Factures et devis séparés</p>
        </div>
      </div>
      <nav>
        <button className={view === 'factures' ? 'active' : ''} onClick={() => setView('factures')}>Factures</button>
        <button className={view === 'devis' ? 'active' : ''} onClick={() => setView('devis')}>Devis</button>
        <button className={view === 'archives-factures' ? 'active' : ''} onClick={() => setView('archives-factures')}>Archives factures</button>
        <button className={view === 'archives-devis' ? 'active' : ''} onClick={() => setView('archives-devis')}>Archives devis</button>
        <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>Entreprise</button>
      </nav>
      <div className="topbar-right">
        <span className={`sync-pill ${supabase ? 'online' : 'local'}`}>{syncStatus}</span>
        <span className="user-pill">{appUser?.displayName || appUser?.username} • {appUser?.role}</span>
        <button className="small" onClick={onLogout}>Déconnexion</button>
      </div>
    </header>
  );
}

function CompanySettings({ company, setCompany, onSave, saving, appUser }) {
  function update(field, value) {
    setCompany((prev) => ({ ...prev, [field]: value }));
  }

  const [accountForm, setAccountForm] = useState({ username: '', displayName: '', password: '', role: 'utilisateur', adminPassword: '' });
  const [accountSaving, setAccountSaving] = useState(false);

  function importLogo(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update('logoDataUrl', reader.result);
    reader.readAsDataURL(file);
  }

  function updateAccount(field, value) {
    setAccountForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleCreateAccount(event) {
    event.preventDefault();
    if (appUser?.role !== 'admin') {
      alert('Seul un administrateur peut créer un compte.');
      return;
    }
    setAccountSaving(true);
    try {
      await adminCreateAccount({
        adminUsername: appUser.username,
        adminPassword: accountForm.adminPassword,
        username: accountForm.username,
        password: accountForm.password,
        displayName: accountForm.displayName,
        role: accountForm.role
      });
      setAccountForm({ username: '', displayName: '', password: '', role: 'utilisateur', adminPassword: '' });
      alert('Compte créé avec succès.');
    } catch (error) {
      alert(`Erreur création compte : ${error.message}`);
    } finally {
      setAccountSaving(false);
    }
  }

  return (
    <main className="screen no-print">
      <section className="card large-card">
        <div className="section-title">
          <div>
            <h2>Informations entreprise</h2>
            <p>Ces informations seront enregistrées définitivement et reprises dans les devis/factures.</p>
          </div>
          <button className="primary" onClick={onSave} disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer définitivement'}</button>
        </div>

        <div className="settings-grid">
          <label>Nom de l'entreprise<input value={company.name} onChange={(e) => update('name', e.target.value)} /></label>
          <label>Adresse<input value={company.address} onChange={(e) => update('address', e.target.value)} /></label>
          <label>Téléphone 1<input value={company.phone1} onChange={(e) => update('phone1', e.target.value)} /></label>
          <label>Téléphone 2<input value={company.phone2} onChange={(e) => update('phone2', e.target.value)} /></label>
          <label>Email<input value={company.email} onChange={(e) => update('email', e.target.value)} /></label>
          <label>SIRET<input value={company.siret} onChange={(e) => update('siret', e.target.value)} /></label>
          <label>TVA<input value={company.tva} onChange={(e) => update('tva', e.target.value)} /></label>
          <label>Logo<input type="file" accept="image/*" onChange={importLogo} /></label>
        </div>

        <div className="logo-preview-box">
          <img src={company.logoDataUrl || '/logo.png'} alt="Logo entreprise" />
          <p>Logo affiché en haut à gauche sur chaque facture et chaque devis. Tu peux garder celui fourni ou importer une autre version.</p>
        </div>
      </section>

      <section className="card large-card">
        <div className="section-title">
          <div>
            <h2>Comptes de connexion</h2>
            <p>Crée un identifiant et un mot de passe pour accéder au logiciel. Le compte reste connecté après actualisation.</p>
          </div>
        </div>

        {appUser?.role !== 'admin' ? (
          <p className="empty">Seul un compte administrateur peut créer d’autres comptes.</p>
        ) : (
          <form className="account-grid" onSubmit={handleCreateAccount}>
            <label>Identifiant du nouveau compte<input value={accountForm.username} onChange={(e) => updateAccount('username', e.target.value)} placeholder="ex : salarie1" /></label>
            <label>Nom affiché<input value={accountForm.displayName} onChange={(e) => updateAccount('displayName', e.target.value)} placeholder="ex : Ahmed" /></label>
            <label>Mot de passe du nouveau compte<input type="password" value={accountForm.password} onChange={(e) => updateAccount('password', e.target.value)} /></label>
            <label>Type de compte<select value={accountForm.role} onChange={(e) => updateAccount('role', e.target.value)}><option value="utilisateur">Utilisateur</option><option value="admin">Admin</option></select></label>
            <label>Ton mot de passe admin pour confirmer<input type="password" value={accountForm.adminPassword} onChange={(e) => updateAccount('adminPassword', e.target.value)} /></label>
            <div className="account-action"><button className="primary" type="submit" disabled={accountSaving}>{accountSaving ? 'Création...' : 'Créer le compte'}</button></div>
          </form>
        )}
      </section>
    </main>
  );
}

function DocumentEditor({ type, document, setDocument, company, refreshDocuments, setFactureDocument, setView }) {
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const totals = useMemo(() => calculateTotals(document), [document]);
  const title = labelForType(type);
  const isInvoice = type === 'facture';

  function updateDocument(field, value) {
    setDocument((prev) => ({ ...prev, [field]: value }));
  }

  function updateClient(field, value) {
    setDocument((prev) => ({ ...prev, client: { ...prev.client, [field]: value } }));
  }

  function updateIntervention(interventionId, field, value) {
    setDocument((prev) => ({
      ...prev,
      interventions: prev.interventions.map((item) => item.id === interventionId ? { ...item, [field]: value } : item)
    }));
  }

  function addIntervention() {
    setDocument((prev) => ({
      ...prev,
      interventions: [...prev.interventions, createIntervention(prev.interventions.length + 1)]
    }));
  }

  function deleteIntervention(interventionId) {
    setDocument((prev) => ({
      ...prev,
      interventions: prev.interventions.length === 1
        ? prev.interventions
        : prev.interventions.filter((item) => item.id !== interventionId)
    }));
  }

  function addLine(interventionId) {
    setDocument((prev) => ({
      ...prev,
      interventions: prev.interventions.map((item) => item.id === interventionId
        ? { ...item, lines: [...item.lines, createLine()] }
        : item)
    }));
  }

  function updateLine(interventionId, lineId, field, value) {
    setDocument((prev) => ({
      ...prev,
      interventions: prev.interventions.map((item) => item.id === interventionId
        ? { ...item, lines: item.lines.map((line) => line.id === lineId ? { ...line, [field]: value } : line) }
        : item)
    }));
  }

  function deleteLine(interventionId, lineId) {
    setDocument((prev) => ({
      ...prev,
      interventions: prev.interventions.map((item) => {
        if (item.id !== interventionId) return item;
        if (item.lines.length === 1) return item;
        return { ...item, lines: item.lines.filter((line) => line.id !== lineId) };
      })
    }));
  }

  async function saveCurrent(nextStatus = document.status) {
    setSaving(true);
    try {
      const snapshot = { ...document, type, status: nextStatus, companySnapshot: { ...company }, totals };
      const saved = await upsertDocument(snapshot);
      setDocument(saved);
      await refreshDocuments();
      alert(nextStatus === 'cloture' ? `${title} clôturé et enregistré.` : `${title} enregistré.`);
    } catch (error) {
      alert(`Erreur sauvegarde : ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function createNew() {
    const numero = await nextNumber(type);
    setDocument(createDraftDocument(type, numero, company));
  }

  async function convertToInvoice() {
    const numero = await nextNumber('facture');
    const invoice = createDraftDocument('facture', numero, company);
    const converted = {
      ...invoice,
      client: { ...document.client },
      interventions: document.interventions.map((intervention) => ({
        ...intervention,
        id: makeId(),
        lines: intervention.lines.map((line) => ({ ...line, id: makeId() }))
      })),
      conditions: document.conditions,
      tvaRate: document.tvaRate,
      notes: document.notes ? `${document.notes}\n\nFacture créée depuis le devis ${document.numero}` : `Facture créée depuis le devis ${document.numero}`
    };
    setFactureDocument(converted);
    setView('factures');
    alert('La facture a été préparée à partir du devis. Vérifie puis clique sur Enregistrer.');
  }


  async function handleDownloadPdf() {
    setExporting(true);
    try {
      await downloadDocumentPdf({ ...document, type, companySnapshot: company, totals });
    } catch (error) {
      alert(`Erreur téléchargement PDF : ${error.message}`);
    } finally {
      setExporting(false);
    }
  }

  function handleWhatsapp() {
    const currentDocument = { ...document, type, companySnapshot: company, totals };
    if (!normalizeWhatsappPhone(currentDocument.client?.phone)) {
      alert('Le téléphone client est vide. WhatsApp va quand même s’ouvrir avec le message, mais sans destinataire sélectionné.');
    }
    openWhatsappForDocument(currentDocument);
  }

  return (
    <main className="workspace">
      <section className="editor-panel no-print">
        <div className="card actions-card model-card">
          <div>
            <span className="module-label">Module {isInvoice ? 'Factures' : 'Devis'}</span>
            <h2>{title} en cours</h2>
          </div>
          <button className="primary" onClick={createNew}>{isInvoice ? 'Nouvelle facture' : 'Nouveau devis'}</button>
          {!isInvoice && <button onClick={convertToInvoice}>Transformer en facture</button>}
          <button onClick={() => saveCurrent()} disabled={saving}>{saving ? 'Sauvegarde...' : 'Enregistrer'}</button>
          <button className="success" onClick={() => saveCurrent('cloture')} disabled={saving}>Clôturer avec calcul final</button>
          <button onClick={() => window.print()}>Imprimer</button>
          <button className="pdf" onClick={handleDownloadPdf} disabled={exporting}>{exporting ? 'Téléchargement...' : 'Télécharger PDF'}</button>
          <button className="whatsapp" onClick={handleWhatsapp}>Envoyer WhatsApp</button>
        </div>

        <div className="totals-strip">
          <div><span>Total HT</span><strong>{money(totals.totalHt)}</strong></div>
          <div><span>TVA {totals.tvaRate}%</span><strong>{money(totals.tva)}</strong></div>
          <div><span>Total TTC</span><strong>{money(totals.totalTtc)}</strong></div>
        </div>

        <div className="card">
          <h2>Numéro et date</h2>
          <div className="two-cols">
            <label>Type
              <input value={title} readOnly />
            </label>
            <label>Numéro automatique
              <input value={document.numero} onChange={(e) => updateDocument('numero', e.target.value)} />
            </label>
            <label>Date
              <input type="date" value={document.date} onChange={(e) => updateDocument('date', e.target.value)} />
            </label>
            <label>TVA (%)
              <input type="number" step="0.1" value={document.tvaRate} onChange={(e) => updateDocument('tvaRate', e.target.value)} />
            </label>
          </div>
        </div>

        <div className="card">
          <h2>Client</h2>
          <div className="client-grid">
            <label>Nom / Société<input value={document.client.name} onChange={(e) => updateClient('name', e.target.value)} /></label>
            <label>Téléphone<input value={document.client.phone} onChange={(e) => updateClient('phone', e.target.value)} /></label>
            <label>Email<input value={document.client.email} onChange={(e) => updateClient('email', e.target.value)} /></label>
            <label>Adresse<textarea value={document.client.address} onChange={(e) => updateClient('address', e.target.value)} /></label>
          </div>
        </div>

        <div className="card">
          <div className="section-title compact">
            <div>
              <h2>Descriptions et interventions</h2>
              <p>Chaque partie a une description, un nom d’intervention, ses lignes de tarification puis son sous-total automatique.</p>
            </div>
            <button onClick={addIntervention}>+ Ajouter une intervention</button>
          </div>
          {document.interventions.map((intervention, index) => {
            const subtotal = calculateIntervention(intervention);
            return (
              <div className="intervention-edit" key={intervention.id}>
                <div className="intervention-head-edit">
                  <strong>Partie {index + 1}</strong>
                  <div className="inline-total">Sous-total : {money(subtotal)}</div>
                  <button className="danger" onClick={() => deleteIntervention(intervention.id)}>Supprimer intervention</button>
                </div>

                <label>Description principale
                  <textarea
                    value={intervention.description}
                    onChange={(e) => updateIntervention(intervention.id, 'description', e.target.value)}
                    placeholder="Ex : Porte de garage, porte d'entrée principale, serrure de sécurité..."
                  />
                </label>

                <label>Nom de l'intervention
                  <input
                    value={intervention.title}
                    onChange={(e) => updateIntervention(intervention.id, 'title', e.target.value)}
                    placeholder="Ex : Dépannage serrurerie, pose de cylindre, ouverture de porte..."
                  />
                </label>

                <div className="line-editor-table">
                  <div className="line-editor-header">
                    <span>Description</span><span>Qté</span><span>Prix unitaire HT</span><span>Prix HT</span><span></span>
                  </div>
                  {intervention.lines.map((line) => (
                    <div className="line-editor-row" key={line.id}>
                      <input value={line.description} onChange={(e) => updateLine(intervention.id, line.id, 'description', e.target.value)} placeholder="Détail de l’intervention réalisée" />
                      <input type="number" min="0" step="0.01" value={line.quantity} onChange={(e) => updateLine(intervention.id, line.id, 'quantity', e.target.value)} />
                      <input type="number" min="0" step="0.01" value={line.unitHt} onChange={(e) => updateLine(intervention.id, line.id, 'unitHt', e.target.value)} />
                      <b>{money(calculateLine(line))}</b>
                      <button className="danger small" onClick={() => deleteLine(intervention.id, line.id)}>X</button>
                    </div>
                  ))}
                  <div className="line-editor-subtotal"><span>Sous-total de cette partie</span><strong>{money(subtotal)}</strong></div>
                </div>
                <button onClick={() => addLine(intervention.id)}>+ Ajouter une ligne de tarification</button>
              </div>
            );
          })}
        </div>

        <div className="card">
          <h2>Conditions et notes</h2>
          <label>Conditions de règlement<textarea value={document.conditions} onChange={(e) => updateDocument('conditions', e.target.value)} /></label>
          <label>Note libre<textarea value={document.notes} onChange={(e) => updateDocument('notes', e.target.value)} /></label>
        </div>
      </section>

      <section className="preview-shell">
        <DocumentPreview document={{ ...document, type, companySnapshot: company, totals }} />
      </section>
    </main>
  );
}

function DocumentPreview({ document }) {
  const company = document.companySnapshot || DEFAULT_COMPANY;
  const totals = document.totals || calculateTotals(document);
  const title = labelForType(document.type);

  return (
    <article className="print-page model-two">
      <div className="page-watermark">{title}</div>
      <div className="document-hero">
        <div className="hero-left">
          <div className="logo-card">
            <img src={company.logoDataUrl || '/logo.png'} alt="Logo" />
          </div>
          <div className="company-title">
            <h1>{company.name}</h1>
            <p>{company.address}</p>
            <p>{[company.phone1, company.phone2].filter(Boolean).join(' / ')}</p>
            {company.email && <p>{company.email}</p>}
          </div>
        </div>
        <div className="hero-right">
          <h2>{title}</h2>
          <div className="meta-line"><span>N°</span><strong>{document.numero}</strong></div>
          <div className="meta-line"><span>Date</span><strong>{formatDateFr(document.date)}</strong></div>
          <div className={`status-badge ${document.status === 'cloture' ? 'done' : ''}`}>{document.status === 'cloture' ? 'Clôturé' : 'Brouillon'}</div>
        </div>
      </div>

      <div className="address-row model-two-address">
        <div className="info-box emitter-box">
          <p className="box-label">Émetteur</p>
          <h3>{company.name}</h3>
          <p>{company.address}</p>
          {company.phone1 && <p>Tél : {company.phone1}</p>}
          {company.phone2 && <p>Tél : {company.phone2}</p>}
          {company.email && <p>Email : {company.email}</p>}
          {company.siret && <p>SIRET : {company.siret}</p>}
          {company.tva && <p>TVA : {company.tva}</p>}
        </div>
        <div className="info-box client-box">
          <p className="box-label">Client</p>
          <h3>{document.client.name || 'Nom du client'}</h3>
          <p>{document.client.address || 'Adresse du client'}</p>
          {document.client.phone && <p>Tél : {document.client.phone}</p>}
          {document.client.email && <p>Email : {document.client.email}</p>}
        </div>
      </div>

      <table className="invoice-table model-two-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Quantité</th>
            <th>Prix unitaire HT</th>
            <th>Prix HT</th>
          </tr>
        </thead>
        <tbody>
          {document.interventions.map((intervention, index) => (
            <React.Fragment key={intervention.id}>
              <tr className="part-description-row">
                <td colSpan="4"><span>Description {index + 1}</span>{intervention.description || 'Description générale de la partie'}</td>
              </tr>
              <tr className="intervention-title-row">
                <td colSpan="4">{intervention.title || `Intervention ${index + 1}`}</td>
              </tr>
              {intervention.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.description || 'Détail de l’intervention'}</td>
                  <td>{safeNumber(line.quantity)}</td>
                  <td>{money(line.unitHt)}</td>
                  <td>{money(calculateLine(line))}</td>
                </tr>
              ))}
              <tr className="subtotal-row">
                <td colSpan="3">Sous-total {intervention.title || `intervention ${index + 1}`}</td>
                <td>{money(calculateIntervention(intervention))}</td>
              </tr>
            </React.Fragment>
          ))}
        </tbody>
      </table>

      <div className="bottom-row">
        <div className="conditions-box">
          <h3>Conditions de règlement</h3>
          <pre>{document.conditions}</pre>
          {document.notes && <><h3>Notes</h3><pre>{document.notes}</pre></>}
        </div>
        <table className="totals-table">
          <tbody>
            <tr><td>Total H.T</td><td>{money(totals.totalHt)}</td></tr>
            <tr><td>T.V.A {totals.tvaRate}%</td><td>{money(totals.tva)}</td></tr>
            <tr className="grand-total"><td>Total T.T.C</td><td>{money(totals.totalTtc)}</td></tr>
          </tbody>
        </table>
      </div>
    </article>
  );
}

function Archives({ type, documents, setFactureDocument, setDevisDocument, setDocuments, setView }) {
  const [query, setQuery] = useState('');
  const title = type === 'devis' ? 'Archives devis' : 'Archives factures';
  const filtered = documents.filter((doc) => {
    const content = `${doc.numero} ${doc.client?.name || ''} ${doc.client?.phone || ''} ${doc.status || ''}`.toLowerCase();
    return content.includes(query.toLowerCase());
  });

  async function deleteDoc(doc) {
    if (!confirm(`Supprimer définitivement ${doc.numero} ?`)) return;
    try {
      await removeDocument(type, doc.id);
      setDocuments((prev) => prev.filter((item) => item.id !== doc.id));
    } catch (error) {
      alert(`Erreur suppression : ${error.message}`);
    }
  }

  function editDoc(doc) {
    const normalized = normalizeDocument(doc, doc.companySnapshot || DEFAULT_COMPANY, type);
    if (type === 'devis') {
      setDevisDocument(normalized);
      setView('devis');
    } else {
      setFactureDocument(normalized);
      setView('factures');
    }
  }

  return (
    <main className="screen no-print">
      <section className="card large-card">
        <div className="section-title">
          <div>
            <h2>{title}</h2>
            <p>Les {type === 'devis' ? 'devis' : 'factures'} sont maintenant séparés dans leur propre module et leur propre table Supabase.</p>
          </div>
          <div className="archive-filters">
            <input placeholder="Recherche client / numéro / téléphone" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>

        <div className="archive-list">
          {filtered.length === 0 && <p className="empty">Aucun document trouvé.</p>}
          {filtered.map((doc) => {
            const totals = calculateTotals(doc);
            return (
              <div className="archive-item" key={doc.id}>
                <div>
                  <strong>{doc.numero}</strong>
                  <span>{labelForType(type)} — {formatDateFr(doc.date)} — {doc.status === 'cloture' ? 'Clôturé' : 'Brouillon'}</span>
                  <p>{doc.client?.name || 'Client non renseigné'} — {money(totals.totalTtc)}</p>
                </div>
                <div>
                  <button onClick={() => editDoc(doc)}>Modifier / ouvrir</button>
                  <button className="danger" onClick={() => deleteDoc(doc)}>Supprimer</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function App() {
  const [appUser, setAppUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [view, setView] = useState('factures');
  const [company, setCompany] = useState(DEFAULT_COMPANY);
  const [factures, setFactures] = useState([]);
  const [devis, setDevis] = useState([]);
  const [factureDocument, setFactureDocument] = useState(null);
  const [devisDocument, setDevisDocument] = useState(null);
  const [syncStatus, setSyncStatus] = useState(supabase ? 'Supabase connecté' : 'Mode local');
  const [savingCompany, setSavingCompany] = useState(false);

  async function refreshDocuments(companyOverride = company) {
    const loaded = await loadAllDocuments(companyOverride);
    setFactures(loaded.factures);
    setDevis(loaded.devis);
    return loaded;
  }

  useEffect(() => {
    async function checkAuth() {
      try {
        const usersExist = await appHasUsers();
        setNeedsSetup(!usersExist);
        const session = getStoredSession();
        if (session?.user?.username && usersExist) {
          setAppUser(session.user);
        }
      } catch (error) {
        console.error('Contrôle connexion impossible', error);
        const usersExist = getLocalUsers().length > 0;
        setNeedsSetup(!usersExist);
        const session = getStoredSession();
        if (session?.user?.username && usersExist) setAppUser(session.user);
      } finally {
        setAuthChecked(true);
      }
    }
    checkAuth();
  }, []);

  useEffect(() => {
    if (!appUser) return;
    async function boot() {
      try {
        const loadedCompany = await loadCompany();
        setCompany(loadedCompany);
        const loadedDocs = await loadAllDocuments(loadedCompany);
        setFactures(loadedDocs.factures);
        setDevis(loadedDocs.devis);
        const factureNumero = await nextNumber('facture');
        const devisNumero = await nextNumber('devis');
        setFactureDocument(createDraftDocument('facture', factureNumero, loadedCompany));
        setDevisDocument(createDraftDocument('devis', devisNumero, loadedCompany));
        setSyncStatus(supabase ? 'Supabase connecté' : 'Mode local');
      } catch (error) {
        console.error(error);
        setSyncStatus('Mode local de secours');
        const localState = getLocalState();
        setCompany(localState.company || DEFAULT_COMPANY);
        setFactures(localState.factures || []);
        setDevis(localState.devis || []);
        const factureNumero = await nextNumber('facture');
        const devisNumero = await nextNumber('devis');
        setFactureDocument(createDraftDocument('facture', factureNumero, localState.company || DEFAULT_COMPANY));
        setDevisDocument(createDraftDocument('devis', devisNumero, localState.company || DEFAULT_COMPANY));
      }
    }
    boot();
  }, [appUser]);

  async function handleSaveCompany() {
    setSavingCompany(true);
    try {
      await saveCompany(company);
      alert('Informations entreprise enregistrées.');
    } catch (error) {
      alert(`Erreur sauvegarde entreprise : ${error.message}`);
    } finally {
      setSavingCompany(false);
    }
  }

  function handleAuthenticated(user) {
    setAppUser(user);
    setNeedsSetup(false);
  }

  function handleLogout() {
    clearSession();
    setAppUser(null);
    setFactureDocument(null);
    setDevisDocument(null);
  }

  if (!authChecked) {
    return <div className="loading">Chargement de la connexion...</div>;
  }

  if (!appUser) {
    return <AuthGate needsSetup={needsSetup} onAuthenticated={handleAuthenticated} />;
  }

  if (!factureDocument || !devisDocument) {
    return <div className="loading">Chargement...</div>;
  }

  return (
    <>
      <Header view={view} setView={setView} syncStatus={syncStatus} appUser={appUser} onLogout={handleLogout} />
      {view === 'factures' && (
        <DocumentEditor
          type="facture"
          document={factureDocument}
          setDocument={setFactureDocument}
          company={company}
          refreshDocuments={refreshDocuments}
          setFactureDocument={setFactureDocument}
          setView={setView}
        />
      )}
      {view === 'devis' && (
        <DocumentEditor
          type="devis"
          document={devisDocument}
          setDocument={setDevisDocument}
          company={company}
          refreshDocuments={refreshDocuments}
          setFactureDocument={setFactureDocument}
          setView={setView}
        />
      )}
      {view === 'archives-factures' && (
        <Archives
          type="facture"
          documents={factures}
          setDocuments={setFactures}
          setFactureDocument={setFactureDocument}
          setDevisDocument={setDevisDocument}
          setView={setView}
        />
      )}
      {view === 'archives-devis' && (
        <Archives
          type="devis"
          documents={devis}
          setDocuments={setDevis}
          setFactureDocument={setFactureDocument}
          setDevisDocument={setDevisDocument}
          setView={setView}
        />
      )}
      {view === 'settings' && <CompanySettings company={company} setCompany={setCompany} onSave={handleSaveCompany} saving={savingCompany} appUser={appUser} />}
    </>
  );
}

createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
