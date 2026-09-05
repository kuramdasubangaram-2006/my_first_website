const csrf = document.querySelector('meta[name="csrf-token"]').content;
const headers = {'Content-Type': 'application/json', 'X-CSRF-Token': csrf};
const list = document.getElementById('link-list');

async function loadLinks() {
  const query = encodeURIComponent(document.getElementById('link-search').value);
  const response = await fetch(`/api/links?q=${query}`);
  const links = await response.json();
  document.getElementById('link-count').textContent = links.length;
  document.getElementById('visit-count').textContent = links.reduce((total, link) => total + link.visits, 0);
  list.innerHTML = links.length ? links.map(link => `<div class="link-row"><div class="link-id">${link.id}<small>${link.url || `${location.origin}/article/${link.id}`}</small></div><time>${new Date(link.created_at).toLocaleString()}</time><span class="visit-count">${link.visits} visits</span><button class="text-button" data-link="${link.id}">→</button></div>`).join('') : '<p class="empty">No links match this search.</p>';
  document.querySelectorAll('[data-link]').forEach(button => button.addEventListener('click', () => showVisits(button.dataset.link)));
}

document.getElementById('create-link').addEventListener('click', async () => {
  const button = document.getElementById('create-link');
  const status = document.getElementById('link-status');
  button.disabled = true;
  status.textContent = 'Generating...';
  const response = await fetch('/api/links', {method: 'POST', headers});
  if (response.ok) {
    const link = await response.json();
    await loadLinks();
    try {
      await navigator.clipboard.writeText(link.url);
      status.textContent = 'Link copied to clipboard.';
    } catch (_) {
      status.textContent = `Link ready: ${link.url}`;
    }
  } else {
    status.textContent = 'Could not generate link.';
  }
  button.disabled = false;
});
document.getElementById('link-search').addEventListener('input', loadLinks);
document.getElementById('close-visits').addEventListener('click', () => document.getElementById('visits-panel').classList.add('hidden'));

async function showVisits(linkId) {
  const response = await fetch(`/api/links/${linkId}/visits`);
  const visits = await response.json();
  document.getElementById('visits-panel').classList.remove('hidden');
  document.getElementById('visits-title').textContent = `Visits / ${linkId}`;
  document.getElementById('visit-list').innerHTML = visits.length ? visits.map(visit => { let intel = {}; try { intel = JSON.parse(visit.ip_intelligence); } catch (_) {} return `<div class="visit-row"><div><b>${visit.ip_address}</b><small>${visit.visited_at}</small></div><div>${visit.browser}<small>${visit.operating_system} · ${visit.device_type}</small></div><div>${intel.city || 'Approx. location unavailable'}<small>${intel.country_name || 'Local/private IP'}</small></div><div>${visit.language || 'Not supplied'}<small>${visit.screen_resolution || 'Resolution pending'}</small></div></div>`; }).join('') : '<p class="empty">No visitor records yet.</p>';
  document.getElementById('visits-panel').scrollIntoView({behavior: 'smooth'});
}

document.getElementById('domain-form').addEventListener('submit', async event => { event.preventDefault(); const domain = event.target.domain.value; const box = document.getElementById('domain-result'); box.textContent = 'Querying public records…'; const response = await fetch('/api/domain-analysis', {method: 'POST', headers, body: JSON.stringify({domain})}); const data = await response.json(); box.textContent = data.error || `${data.domain}\nRegistrar: ${data.metadata.registrar || 'not supplied'}\nCreated: ${data.metadata.creation_date || 'not supplied'}\nExpires: ${data.metadata.expiration_date || 'not supplied'}\nNameservers: ${data.metadata.nameservers.join(', ') || 'none found'}\n\n${Object.entries(data.records).map(([type, records]) => `${type}: ${records.join(', ') || 'none found'}`).join('\n')}\n\n${data.note}`; });
loadLinks();
