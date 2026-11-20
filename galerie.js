const element = id => document.getElementById(id);
const images = JSON.parse(element('photo-list').textContent);
const label = element('access-status');
const photo = element('photo');
const slider = element('slider');
const buttons = [];
const stored = new Map();
const encoder = new TextEncoder();
let key;
let current = 0;
let selection = 0;

async function decryptFile(path) {
  const response = await fetch('data/' + path + '.bin', {credentials: 'omit'});
  if (!response.ok) throw new Error('Soubor se nepodařilo načíst.');
  const payload = new Uint8Array(await response.arrayBuffer());
  return crypto.subtle.decrypt({name: 'AES-GCM', iv: payload.subarray(0, 12), additionalData: encoder.encode(path)}, key, payload.subarray(12));
}

function objectURL(path, type = 'image/jpeg') {
  if (!stored.has(path)) {
    const result = decryptFile(path).then(data => URL.createObjectURL(new Blob([data], {type})));
    stored.set(path, result);
    result.catch(() => stored.delete(path));
  }
  return stored.get(path);
}

function split(value) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  slider.value = percent;
  slider.setAttribute('aria-valuetext', percent + ' % původní fotografie');
  photo.style.setProperty('--split', percent + '%');
  photo.querySelector('.tag:first-of-type').hidden = percent < 5;
  photo.querySelector('.tag.after').hidden = percent > 95;
}

function photoNote(id) {
  if ([5008, 5014, 5021, 5098].includes(id)) return 'Původní fotografie výhledu.';
  if ([4979, 4985, 4990, 4997, 4999].includes(id)) return 'Pohovka je doplněná virtuálně. Posunutím dělicí čáry lze zobrazit původní stav.';
  if ([5103, 5116, 5120, 5124].includes(id)) return 'Zakryté části lůžek jsou doplněné podle ostatních pohledů.';
  return 'Posunutím dělicí čáry lze porovnat obě verze.';
}

async function select(index) {
  current = (index + images.length) % images.length;
  const stamp = ++selection;
  const [id, room] = images[current];
  const name = 'P119' + id + '.jpg';
  const before = element('before');
  const after = element('after');
  const download = element('download');
  element('room').textContent = room;
  element('file').textContent = name;
  element('count').textContent = (current + 1) + ' / ' + images.length;
  element('note').textContent = 'Načítání fotografie…';
  photo.setAttribute('aria-busy', 'true');
  before.hidden = after.hidden = true;
  download.removeAttribute('href');
  split(0);
  buttons.forEach((b, i) => {
    if (i === current) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  });
  try {
    const [original, edited] = await Promise.all([objectURL('Pred/' + name), objectURL('Fotografie/' + name)]);
    if (stamp !== selection) return;
    before.alt = room + ', původní fotografie';
    after.alt = room + ', výsledná fotografie';
    before.src = original;
    after.src = edited;
    await Promise.all([before.decode(), after.decode()]);
    if (stamp !== selection) return;
    photo.style.aspectRatio = after.naturalWidth + ' / ' + after.naturalHeight;
    before.hidden = after.hidden = false;
    download.href = edited;
    download.download = name;
    element('note').textContent = photoNote(id);
  } catch {
    if (stamp === selection) element('note').textContent = 'Fotografii se nepodařilo načíst. Zkuste ji prosím znovu vybrat.';
  } finally {
    if (stamp === selection) photo.setAttribute('aria-busy', 'false');
  }
}

function thumbnails() {
  images.forEach(([id, room], i) => {
    const name = 'P119' + id;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'thumb';
    button.setAttribute('aria-label', room + ', ' + name);
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    const caption = document.createElement('span');
    caption.textContent = name;
    button.append(img, caption);
    element('thumbs').append(button);
    buttons.push(button);
    button.addEventListener('click', () => {
      select(i);
      document.querySelector('.tools').scrollIntoView({block:'start'});
    });
    objectURL('Nahledy/' + name + '.jpg').then(url => { img.src = url; }).catch(() => {});
  });
}

const zip = element('all-download');
zip.addEventListener('click', async e => {
  if (zip.href.startsWith('blob:')) return;
  e.preventDefault();
  if (zip.getAttribute('aria-busy') === 'true') return;
  zip.setAttribute('aria-busy', 'true');
  zip.textContent = 'Příprava ZIPu…';
  try {
    zip.href = await objectURL(zip.download, 'application/zip');
    zip.textContent = 'Stáhnout 30 JPG';
    zip.click();
  } catch {
    zip.textContent = 'Zkusit stáhnout znovu';
  } finally {
    zip.removeAttribute('aria-busy');
  }
});

element('prev').addEventListener('click', () => select(current - 1));
element('next').addEventListener('click', () => select(current + 1));
slider.addEventListener('input', () => split(Number(slider.value)));
document.addEventListener('keydown', e => {
  if (element('gallery').hidden || e.target === slider || e.altKey || e.metaKey || e.ctrlKey) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    select(current + (e.key === 'ArrowLeft' ? -1 : 1));
  }
});

async function openGallery() {
  const parts = new URLSearchParams(location.hash.slice(1));
  const encoded = parts.get('k') || '';
  if (!/^[\w-]{43}$/.test(encoded)) {
    label.textContent = 'Pro zobrazení galerie otevřete celý odkaz, který jste dostali.';
    return;
  }
  try {
    const raw = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/') + '='), c => c.charCodeAt(0));
    key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    await decryptFile('overeni');
  } catch {
    label.textContent = 'Galerii se nepodařilo otevřít. Zkontrolujte celý odkaz a připojení k internetu.';
    return;
  }
  label.hidden = true;
  element('gallery').hidden = false;
  const fromLink = images.findIndex(([id]) => 'P119' + id === parts.get('foto'));
  const ready = select(fromLink < 0 ? images.findIndex(([id]) => id === 4997) : fromLink);
  thumbnails();
  buttons[current].setAttribute('aria-current', 'true');
  await ready;
}

openGallery();
