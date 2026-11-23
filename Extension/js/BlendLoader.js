/*
 * Minimal .blend reader (Blender 2.80 -> 5.x): parses the file blocks and the SDNA (the struct
 * catalogue stored in every .blend), then extracts meshes, object transforms, the collection
 * hierarchy of the active scene and material viewport colors. Modifiers are not evaluated.
 * Compressed files: gzip (Blender < 3.0) and zstd (3.0+, needs fzstd).
 */
(function (global) {
  'use strict';

  async function decompress(buf) {
    let u8 = new Uint8Array(buf);
    if (u8[0] === 0x1f && u8[1] === 0x8b) {
      const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
      u8 = new Uint8Array(await new Response(s).arrayBuffer());
    } else if (u8[0] === 0x28 && u8[1] === 0xb5 && u8[2] === 0x2f && u8[3] === 0xfd) {
      if (typeof fzstd === 'undefined') throw new Error('zstd-compressed .blend: fzstd missing');
      u8 = zstdAll(u8);
    }
    return u8;
  }

  // Blender writes several zstd frames plus a trailing skippable "seek table" frame
  function zstdAll(u8) {
    const parts = []; let o = 0, total = 0;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    while (o + 8 <= u8.length) {
      const magic = dv.getUint32(o, true);
      if ((magic & 0xfffffff0) === 0x184d2a50) { o += 8 + dv.getUint32(o + 4, true); continue; }
      const len = zstdFrameLength(u8, dv, o);
      const out = fzstd.decompress(u8.subarray(o, o + len));
      parts.push(out); total += out.length; o += len;
    }
    const res = new Uint8Array(total); let p = 0;
    for (const x of parts) { res.set(x, p); p += x.length; }
    return res;
  }

  function zstdFrameLength(u8, dv, o) {
    const start = o; o += 4;
    const fhd = u8[o++];
    const singleSeg = (fhd >> 5) & 1, checksum = (fhd >> 2) & 1, dictId = fhd & 3, fcsFlag = fhd >> 6;
    if (!singleSeg) o++;
    o += [0, 1, 2, 4][dictId];
    o += [singleSeg ? 1 : 0, 2, 4, 8][fcsFlag];
    for (;;) {
      const bh = u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16); o += 3;
      const last = bh & 1, type = (bh >> 1) & 3, size = bh >>> 3;
      o += type === 1 ? 1 : size;
      if (last) break;
    }
    if (checksum) o += 4;
    return o - start;
  }

  class BlendFile {
    constructor(u8) {
      const td = new TextDecoder('latin1');
      const magic = td.decode(u8.subarray(0, 7));
      if (magic !== 'BLENDER') throw new Error('Not a .blend file');
      this.u8 = u8;
      this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      let o;
      if (u8[7] === 0x5f || u8[7] === 0x2d) { // "BLENDER-v282": legacy 12-byte header
        this.ptr = u8[7] === 0x5f ? 4 : 8;
        this.le = u8[8] === 0x76;
        this.version = +td.decode(u8.subarray(9, 12));
        this.bheadLarge = false;
        o = 12;
      } else { // "BLENDER17-01v0502": 5.0+ header, 64-bit block lengths
        const hsize = +td.decode(u8.subarray(7, 9));
        this.ptr = 8;
        this.le = u8[12] === 0x76;
        this.version = +td.decode(u8.subarray(13, 17));
        this.bheadLarge = true;
        o = hsize;
      }
      if (!this.le) throw new Error('Big-endian .blend files are not supported');
      // Since 5.0, DATA pointers are only unique within the ID they follow: resolve them per owner ID
      this.blocks = []; this.byPtr = new Map(); this.local = [];
      let owner = -1;
      for (;;) {
        const code = td.decode(u8.subarray(o, o + 4)).replace(/\0+$/, '');
        let b;
        if (this.bheadLarge) {
          b = { code, sdna: this.i32(o + 4), old: this.ptrAt(o + 8), len: Number(this.dv.getBigInt64(o + 16, true)), nr: Number(this.dv.getBigInt64(o + 24, true)), data: o + 32 };
        } else if (this.ptr === 8) {
          b = { code, len: this.i32(o + 4), old: this.ptrAt(o + 8), sdna: this.i32(o + 16), nr: this.i32(o + 20), data: o + 24 };
        } else {
          b = { code, len: this.i32(o + 4), old: this.ptrAt(o + 8), sdna: this.i32(o + 12), nr: this.i32(o + 16), data: o + 20 };
        }
        if (code === 'ENDB') break;
        if (code !== 'DATA') { owner = this.blocks.length; this.local[owner] = new Map(); if (b.old) this.byPtr.set(b.old, b); }
        b.owner = owner;
        this.blocks.push(b);
        if (code === 'DATA' && b.old) { if (owner >= 0) this.local[owner].set(b.old, b); if (!this.byPtr.has(b.old)) this.byPtr.set(b.old, b); }
        o = b.data + b.len;
        if (o > u8.length) throw new Error('Truncated .blend file');
      }
      const dna = this.blocks.find(b => b.code === 'DNA1');
      if (!dna) throw new Error('No SDNA in file');
      this.parseSDNA(dna.data);
    }

    i32(o) { return this.dv.getInt32(o, true); }
    ptrAt(o) {
      if (this.ptr === 4) return this.dv.getUint32(o, true) ? String(this.dv.getUint32(o, true)) : 0;
      const v = this.dv.getBigUint64(o, true);
      return v ? String(v) : 0;
    }

    parseSDNA(o) {
      const td = new TextDecoder('latin1'), u8 = this.u8;
      const start = o, align = () => { o = start + ((o - start + 3) & ~3); };
      const readStrings = n => {
        const out = [];
        for (let i = 0; i < n; i++) { let e = o; while (u8[e]) e++; out.push(td.decode(u8.subarray(o, e))); o = e + 1; }
        return out;
      };
      const tag = t => { const s = td.decode(u8.subarray(o, o + 4)); if (s !== t) throw new Error('SDNA: expected ' + t + ', got ' + s); o += 4; };
      tag('SDNA'); tag('NAME');
      const names = readStrings(this.i32((o += 4) - 4)); align();
      tag('TYPE');
      const types = readStrings(this.i32((o += 4) - 4)); align();
      tag('TLEN');
      const tlen = types.map((_, i) => this.dv.getUint16(o + i * 2, true)); o += types.length * 2; align();
      tag('STRC');
      const n = this.i32(o); o += 4;
      this.structs = []; this.structByName = new Map();
      for (let s = 0; s < n; s++) {
        const type = this.dv.getUint16(o, true), nf = this.dv.getUint16(o + 2, true); o += 4;
        const st = { name: types[type], size: tlen[type], fields: new Map() };
        let off = 0;
        for (let f = 0; f < nf; f++) {
          const ft = this.dv.getUint16(o, true), fn = names[this.dv.getUint16(o + 2, true)]; o += 4;
          const isPtr = fn.includes('*');
          let count = 1; for (const m of fn.matchAll(/\[(\d+)\]/g)) count *= +m[1];
          const base = fn.replace(/[*()]/g, '').replace(/\[.*$/, '');
          const size = (isPtr ? this.ptr : tlen[ft]) * count;
          st.fields.set(base, { type: types[ft], off, isPtr, count, size, ptrDepth: (fn.match(/\*/g) || []).length });
          off += size;
        }
        this.structs.push(st); this.structByName.set(st.name, st);
      }
    }

    // ---- Struct access ----
    // A "view" is {st, o}: a struct definition at an absolute file offset.
    view(o, st, ow) { return { st, o, ow }; }
    blockView(b, i = 0) { const st = this.structs[b.sdna]; return { st, o: b.data + i * st.size, ow: b.owner }; }
    has(v, f) { return v.st.fields.has(f); }
    field(v, f) { const d = v.st.fields.get(f); if (!d) throw new Error(v.st.name + '.' + f + ' missing'); return d; }
    get(v, f, i = 0) {
      const d = v.st.fields.get(f); if (!d) return undefined;
      const o = v.o + d.off;
      if (d.isPtr) return this.ptrAt(o + i * this.ptr);
      switch (d.type) {
        case 'char': case 'uchar': case 'int8_t': case 'uint8_t': return this.u8[o + i];
        case 'short': return this.dv.getInt16(o + i * 2, true);
        case 'ushort': case 'uint16_t': return this.dv.getUint16(o + i * 2, true);
        case 'int': case 'int32_t': return this.dv.getInt32(o + i * 4, true);
        case 'uint': case 'uint32_t': return this.dv.getUint32(o + i * 4, true);
        case 'float': return this.dv.getFloat32(o + i * 4, true);
        case 'double': return this.dv.getFloat64(o + i * 8, true);
        case 'int64_t': case 'uint64_t': return Number(this.dv.getBigInt64(o + i * 8, true));
        default: return this.view(o, this.structByName.get(d.type), v.ow);
      }
    }
    floats(v, f) { const d = this.field(v, f); return Array.from({ length: d.count }, (_, i) => this.get(v, f, i)); }
    str(v, f) { const d = this.field(v, f), o = v.o + d.off; let e = o; while (e < o + d.count && this.u8[e]) e++; return new TextDecoder('utf-8').decode(this.u8.subarray(o, e)); }
    sub(v, f) { const d = this.field(v, f); return { st: this.structByName.get(d.type), o: v.o + d.off, ow: v.ow }; }
    deref(p, ow) { if (!p) return undefined; return (ow >= 0 && this.local[ow].get(p)) || this.byPtr.get(p); }
    // follow pointer field f of v to its block
    follow(v, f, i = 0) { return this.deref(this.get(v, f, i), v.ow); }
    // ListBase walk: first -> next
    list(v, f) {
      const out = []; const lb = this.sub(v, f); let p = this.get(lb, 'first'); const seen = new Set();
      while (p && !seen.has(p)) { seen.add(p); const b = this.deref(p, v.ow); if (!b) break; const it = this.blockView(b); out.push(it); p = this.get(it, 'next'); }
      return out;
    }
    idName(v) { return this.str(this.sub(v, 'id'), 'name').slice(2); }
    // Pointer array stored in a DATA block (e.g. Material **mat)
    ptrArray(b, n) { return b ? Array.from({ length: Math.min(n, b.len / this.ptr) }, (_, i) => this.ptrAt(b.data + i * this.ptr)) : []; }
    // Copy raw bytes (file offsets are not always aligned for typed arrays)
    bytes(o, len) { return this.u8.slice(o, o + len); }
    cstr(b) { if (!b) return ''; let e = b.data; while (e < b.data + b.len && this.u8[e]) e++; return new TextDecoder('utf-8').decode(this.u8.subarray(b.data, e)); }
  }

  // ---- Mesh extraction ----
  // Returns {positions: Float32Array, faceStart: Int32Array(np+1), corners: Int32Array, matIndex, smooth, uv}
  function readMesh(f, me) {
    const nv = f.get(me, 'totvert'), np = f.get(me, 'totpoly') ?? f.get(me, 'faces_num'), nl = f.get(me, 'totloop') ?? f.get(me, 'corners_num');
    if (!nv || !np || !nl) return null;
    const attrs = new Map(); // name -> {o, len, stride, dom}
    // 5.0+: AttributeStorage
    if (f.has(me, 'attribute_storage')) {
      const as = f.sub(me, 'attribute_storage'), A = f.structByName.get('Attribute');
      const ab = f.follow(as, 'dna_attributes'), n = f.get(as, 'dna_attributes_num');
      for (let i = 0; ab && i < n; i++) {
        const a = f.view(ab.data + i * A.size, A, me.ow);
        const name = f.cstr(f.follow(a, 'name')), db = f.follow(a, 'data');
        if (!db) continue;
        const holder = f.blockView(db), single = f.get(a, 'storage_type') === 1;
        const d = f.follow(holder, 'data');
        if (d) attrs.set(name, { o: d.data, len: d.len, single, dom: f.get(a, 'domain') });
      }
    }
    // 2.8 -> 4.x: CustomData layers (legacy structs or named generic attributes)
    const legacy = {};
    const L = f.structByName.get('CustomDataLayer');
    for (const cd of ['vdata', 'pdata', 'ldata', 'vert_data', 'face_data', 'corner_data']) {
      if (!f.has(me, cd)) continue;
      const c = f.sub(me, cd), lb = f.follow(c, 'layers'), n = f.get(c, 'totlayer');
      for (let i = 0; lb && i < n; i++) {
        const l = f.view(lb.data + i * L.size, L, me.ow), d = f.follow(l, 'data');
        if (!d) continue;
        const type = f.get(l, 'type'), name = f.str(l, 'name');
        if (type === 0) legacy.mvert = d; else if (type === 25) legacy.mpoly = d; else if (type === 26) legacy.mloop = d;
        else if (type === 16 && !legacy.mloopuv) legacy.mloopuv = d;
        if (name && !attrs.has(name)) attrs.set(name, { o: d.data, len: d.len });
      }
    }
    const f32 = (a, n) => a && a.len >= n * 4 ? new Float32Array(f.bytes(a.o, n * 4).buffer) : null;
    const i32 = (a, n) => a && a.len >= n * 4 ? new Int32Array(f.bytes(a.o, n * 4).buffer) : null;

    let positions = f32(attrs.get('position'), nv * 3);
    let corners = i32(attrs.get('.corner_vert'), nl);
    let faceStart = null, matIndex = null, smooth = null, uv = null;
    const pofs = f.follow(me, 'poly_offset_indices') || f.follow(me, 'face_offset_indices');
    if (pofs) faceStart = i32({ o: pofs.data, len: pofs.len }, np + 1);

    // Legacy MVert / MPoly / MLoop structs (also mirrored in the mvert/mpoly/mloop pointers)
    const mv = legacy.mvert || f.follow(me, 'mvert'), mp = legacy.mpoly || f.follow(me, 'mpoly'), ml = legacy.mloop || f.follow(me, 'mloop');
    if (!positions && mv) {
      const st = f.structByName.get('MVert'), co = st.fields.get('co').off;
      positions = new Float32Array(nv * 3);
      for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) positions[i * 3 + k] = f.dv.getFloat32(mv.data + i * st.size + co + k * 4, true);
    }
    if (!corners && ml) {
      const st = f.structByName.get('MLoop'), vo = st.fields.get('v').off;
      corners = new Int32Array(nl);
      for (let i = 0; i < nl; i++) corners[i] = f.dv.getInt32(ml.data + i * st.size + vo, true);
    }
    if ((!faceStart || !attrs.has('material_index')) && mp) {
      const st = f.structByName.get('MPoly'), F = st.fields;
      faceStart = new Int32Array(np + 1); matIndex = new Int32Array(np); smooth = new Uint8Array(np);
      for (let i = 0; i < np; i++) {
        const o = mp.data + i * st.size;
        faceStart[i] = f.dv.getInt32(o + F.get('loopstart').off, true);
        if (F.has('mat_nr')) matIndex[i] = f.dv.getInt16(o + F.get('mat_nr').off, true);
        if (F.has('flag')) smooth[i] = f.u8[o + F.get('flag').off] & 1;
      }
      faceStart[np] = nl;
    }
    if (!positions || !corners || !faceStart) return null;
    const mi = attrs.get('material_index');
    if (mi && !mi.single) matIndex = i32(mi, np);
    const sf = attrs.get('sharp_face');
    if (!smooth) {
      smooth = new Uint8Array(np).fill(1); // 4.1+: no sharp_face attribute = smooth
      if (sf && sf.single) { if (f.u8[sf.o]) smooth.fill(0); }
      else if (sf && sf.len >= np) for (let i = 0; i < np; i++) smooth[i] = f.u8[sf.o + i] ? 0 : 1;
    }
    // UVs: first float2 corner attribute (named, typically "UVMap"), or legacy MLoopUV
    for (const [name, a] of attrs) {
      if (name.startsWith('.') || a.single || a.len !== nl * 8 || name === '.corner_vert') continue;
      if (a.dom === undefined || a.dom === 3) { uv = f32(a, nl * 2); break; }
    }
    if (!uv && legacy.mloopuv) {
      const st = f.structByName.get('MLoopUV'), uo = st.fields.get('uv').off;
      uv = new Float32Array(nl * 2);
      for (let i = 0; i < nl; i++) { uv[i * 2] = f.dv.getFloat32(legacy.mloopuv.data + i * st.size + uo, true); uv[i * 2 + 1] = f.dv.getFloat32(legacy.mloopuv.data + i * st.size + uo + 4, true); }
    }
    return { positions, faceStart, corners, matIndex, smooth, uv, nv, np, nl };
  }

  // Fan-triangulated, non-indexed geometry with one group per material slot
  function buildGeometry(m) {
    const { positions: P, faceStart: FS, corners: C, matIndex: MI, smooth: SM, uv: UV, nv, np } = m;
    // vertex normals (area weighted, Newell face normals)
    const fn = new Float32Array(np * 3), vn = new Float32Array(nv * 3);
    let tris = 0;
    for (let p = 0; p < np; p++) {
      const s = FS[p], e = FS[p + 1]; if (e - s < 3) continue; tris += e - s - 2;
      let x = 0, y = 0, z = 0;
      for (let i = s; i < e; i++) {
        const a = C[i] * 3, b = C[i + 1 < e ? i + 1 : s] * 3;
        x += (P[a + 1] - P[b + 1]) * (P[a + 2] + P[b + 2]);
        y += (P[a + 2] - P[b + 2]) * (P[a] + P[b]);
        z += (P[a] - P[b]) * (P[a + 1] + P[b + 1]);
      }
      fn[p * 3] = x; fn[p * 3 + 1] = y; fn[p * 3 + 2] = z;
      for (let i = s; i < e; i++) { const v = C[i] * 3; vn[v] += x; vn[v + 1] += y; vn[v + 2] += z; }
    }
    const norm = (a, i) => { const l = Math.hypot(a[i], a[i + 1], a[i + 2]) || 1; a[i] /= l; a[i + 1] /= l; a[i + 2] /= l; };
    for (let i = 0; i < np; i++) norm(fn, i * 3);
    for (let i = 0; i < nv; i++) norm(vn, i * 3);
    // sort faces by material
    const order = Array.from({ length: np }, (_, i) => i);
    if (MI) order.sort((a, b) => MI[a] - MI[b]);
    const pos = new Float32Array(tris * 9), nor = new Float32Array(tris * 9), uv = UV ? new Float32Array(tris * 6) : null;
    const g = new THREE.BufferGeometry(); let t = 0, groupStart = 0, cur = -1;
    const put = (corner, p) => {
      const v = C[corner];
      pos.set(P.subarray(v * 3, v * 3 + 3), t * 3);
      if (SM[p]) nor.set(vn.subarray(v * 3, v * 3 + 3), t * 3); else nor.set(fn.subarray(p * 3, p * 3 + 3), t * 3);
      if (uv) { uv[t * 2] = UV[corner * 2]; uv[t * 2 + 1] = UV[corner * 2 + 1]; }
      t++;
    };
    for (const p of order) {
      const s = FS[p], e = FS[p + 1]; if (e - s < 3) continue;
      const mat = MI ? Math.max(0, MI[p]) : 0;
      if (mat !== cur) { if (cur >= 0) g.addGroup(groupStart, t - groupStart, cur); cur = mat; groupStart = t; }
      for (let i = s + 1; i < e - 1; i++) { put(s, p); put(i, p); put(i + 1, p); }
    }
    if (cur >= 0) g.addGroup(groupStart, t - groupStart, cur);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  }

  // ---- Materials: viewport color, or the Principled BSDF base color / packed image texture ----
  function readMaterial(f, b, cache) {
    if (!b) return null;
    if (cache.has(b)) return cache.get(b);
    const m = f.blockView(b);
    const opts = { name: f.idName(m), color: new THREE.Color(f.get(m, 'r') ?? 0.8, f.get(m, 'g') ?? 0.8, f.get(m, 'b') ?? 0.8), roughness: f.get(m, 'roughness') ?? 0.5, metalness: f.get(m, 'metallic') ?? 0 };
    try {
      const nt = f.follow(m, 'nodetree');
      if (nt) {
        const tree = f.blockView(nt), nodes = f.list(tree, 'nodes'), links = f.list(tree, 'links');
        const kinds = ['ShaderNodeBsdfPrincipled', 'ShaderNodeBsdfDiffuse', 'ShaderNodeEmission'];
        const bsdf = kinds.map(k => nodes.find(n => f.str(n, 'idname') === k)).find(Boolean);
        if (bsdf) {
          const sockets = f.list(bsdf, 'inputs');
          const sock = name => sockets.find(s => f.str(s, 'identifier') === name || f.str(s, 'name') === name);
          const val = (s, n) => { const d = s && f.follow(s, 'default_value'); if (!d) return null; const st = f.structs[d.sdna]; return st && st.fields.has('value') ? f.floats(f.blockView(d), 'value').slice(0, n) : null; };
          const base = sock('Base Color') || sock('Color'), rough = sock('Roughness'), metal = sock('Metallic');
          const c = val(base, 4); if (c) opts.color = new THREE.Color(c[0], c[1], c[2]);
          const r = val(rough, 1); if (r) opts.roughness = r[0];
          const mt = val(metal, 1); if (mt) opts.metalness = mt[0];
          // image texture linked into Base Color
          const link = base && links.find(l => f.deref(f.get(l, 'tosock'), l.ow)?.data === base.o);
          const from = link && f.deref(f.get(link, 'fromnode'), link.ow);
          if (from && f.str(f.blockView(from), 'idname') === 'ShaderNodeTexImage') {
            const im = f.deref(f.get(f.blockView(from), 'id'), from.owner);
            const tex = im && readImage(f, im);
            if (tex) { opts.map = tex; opts.color = new THREE.Color(1, 1, 1); }
          }
        }
      }
    } catch (e) { /* keep viewport color */ }
    const mat = new THREE.MeshStandardMaterial(opts);
    cache.set(b, mat);
    return mat;
  }

  function readImage(f, imb) {
    const im = f.blockView(imb);
    let pf = f.follow(im, 'packedfile');
    if (!pf && f.has(im, 'packedfiles')) { const l = f.list(im, 'packedfiles')[0]; pf = l && f.follow(l, 'packedfile'); }
    if (!pf) return null;
    const p = f.blockView(pf), size = f.get(p, 'size'), d = f.follow(p, 'data');
    if (!d || !size) return null;
    const url = URL.createObjectURL(new Blob([f.bytes(d.data, Math.min(size, d.len))]));
    const tex = new THREE.TextureLoader().load(url);
    tex.encoding = THREE.sRGBEncoding; tex.flipY = false;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // ---- Objects ----
  function localMatrix(f, ob) {
    const loc = f.floats(ob, 'loc'), size = f.floats(ob, 'size'), mode = f.get(ob, 'rotmode');
    const dloc = f.has(ob, 'dloc') ? f.floats(ob, 'dloc') : [0, 0, 0], dscale = f.has(ob, 'dscale') ? f.floats(ob, 'dscale') : [1, 1, 1];
    const q = new THREE.Quaternion();
    if (mode === 0) { const w = f.floats(ob, 'quat'); q.set(w[1], w[2], w[3], w[0]).normalize(); }
    else if (mode === -1) { const ax = f.floats(ob, 'rotAxis'); q.setFromAxisAngle(new THREE.Vector3(...ax).normalize(), f.get(ob, 'rotAngle')); }
    else { const r = f.floats(ob, 'rot'); const order = ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'][(mode || 1) - 1]; q.setFromEuler(new THREE.Euler(r[0], r[1], r[2], order.split('').reverse().join(''))); }
    return new THREE.Matrix4().compose(new THREE.Vector3(loc[0] + dloc[0], loc[1] + dloc[1], loc[2] + dloc[2]), q, new THREE.Vector3(size[0] * dscale[0], size[1] * dscale[1], size[2] * dscale[2]));
  }

  function worldMatrix(f, ob, cache) {
    const key = ob.o; if (cache.has(key)) return cache.get(key);
    let m;
    if (f.has(ob, 'obmat')) { // saved world matrix (Blender < 4.x): includes constraints / bone parents
      m = new THREE.Matrix4().fromArray(f.floats(ob, 'obmat'));
      if (m.determinant() === 0) m = null;
    }
    if (!m) {
      m = localMatrix(f, ob);
      const pb = f.follow(ob, 'parent');
      if (pb && pb !== undefined) {
        const pinv = new THREE.Matrix4().fromArray(f.floats(ob, 'parentinv'));
        m = worldMatrix(f, f.blockView(pb), cache).clone().multiply(pinv).multiply(m);
      }
    }
    cache.set(key, m);
    return m;
  }

  async function parseBlend(buffer) {
    const f = new BlendFile(await decompress(buffer));
    const group = new THREE.Group(); group.name = 'blend';
    const info = { version: f.version, objects: 0, meshes: 0, verts: 0, faces: 0, thumbnail: null };
    // Embedded file preview (TEST block: w, h, RGBA bottom-up)
    const test = f.blocks.find(b => b.code === 'TEST');
    if (test) {
      const w = f.i32(test.data), h = f.i32(test.data + 4);
      if (w > 0 && h > 0 && w * h * 4 + 8 <= test.len) info.thumbnail = { w, h, rgba: f.bytes(test.data + 8, w * h * 4) };
    }
    const mats = new Map(), geoms = new Map(), worlds = new Map();
    const fallback = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6 });

    const addObject = (ob, parentM, depth) => {
      if (depth > 8) return;
      const type = f.get(ob, 'type');
      const M = parentM.clone().multiply(worldMatrix(f, ob, worlds));
      if (type === 1) {
        const mb = f.follow(ob, 'data');
        if (mb && mb.code === 'ME') {
          if (!geoms.has(mb)) {
            const me = f.blockView(mb), data = readMesh(f, me);
            geoms.set(mb, data && { geo: buildGeometry(data), data, me });
            if (data) { info.meshes++; info.verts += data.nv; info.faces += data.np; }
          }
          const g = geoms.get(mb);
          if (g) {
            const n = Math.max(f.get(g.me, 'totcol') || 0, f.get(ob, 'totcol') || 0, 1);
            const meMats = f.ptrArray(f.follow(g.me, 'mat'), n), obMats = f.ptrArray(f.follow(ob, 'mat'), n);
            const bits = f.follow(ob, 'matbits');
            const list = [];
            for (let i = 0; i < n; i++) {
              const useOb = bits && f.u8[bits.data + i];
              const p = useOb ? obMats[i] : meMats[i];
              list.push(readMaterial(f, f.deref(p), mats) || fallback);
            }
            const mesh = new THREE.Mesh(g.geo, list.length > 1 ? list : list[0]);
            mesh.name = f.idName(ob);
            mesh.matrixAutoUpdate = false; mesh.matrix.copy(M);
            group.add(mesh); info.objects++;
          }
        }
      }
      // collection instance (empty instancing a collection)
      const dup = f.follow(ob, 'instance_collection') || f.follow(ob, 'dup_group');
      if (dup && (f.get(ob, 'transflag') & 0x100)) {
        const c = f.blockView(dup), ofs = f.floats(c, 'dupli_ofs');
        addCollection(c, M.clone().multiply(new THREE.Matrix4().makeTranslation(-ofs[0], -ofs[1], -ofs[2])), new Set(), depth + 1);
      }
    };

    const addCollection = (c, M, excluded, depth) => {
      if (f.get(c, 'flag') & 1) return; // hidden in viewport
      for (const co of f.list(c, 'gobject')) {
        const obb = f.follow(co, 'ob');
        if (!obb) continue;
        const ob = f.blockView(obb);
        if (f.get(ob, 'restrictflag') & 1) continue;
        addObject(ob, M, depth);
      }
      for (const ch of f.list(c, 'children')) {
        const cb = f.follow(ch, 'collection');
        if (cb && !excluded.has(cb)) addCollection(f.blockView(cb), M, excluded, depth);
      }
    };

    // Active scene (FileGlobal.curscene), its master collection, minus collections excluded in the first view layer
    const glob = f.blocks.find(b => b.code === 'GLOB');
    let scb = glob && f.follow(f.blockView(glob), 'curscene');
    if (!scb) scb = f.blocks.find(b => b.code === 'SC');
    if (scb) {
      const sc = f.blockView(scb);
      info.scene = f.idName(sc);
      const excluded = new Set();
      const vl = f.list(sc, 'view_layers')[0];
      const walk = lc => {
        for (const l of f.list(lc, 'layer_collections')) {
          const cb = f.follow(l, 'collection');
          if (cb && (f.get(l, 'flag') & 0x10)) excluded.add(cb);
          walk(l);
        }
      };
      if (vl) walk(vl);
      const mc = f.follow(sc, 'master_collection');
      if (mc) addCollection(f.blockView(mc), new THREE.Matrix4(), excluded, 0);
    }
    if (!group.children.length) // no scene: every object
      for (const b of f.blocks) if (b.code === 'OB') addObject(f.blockView(b), new THREE.Matrix4(), 0);
    group.rotation.x = -Math.PI / 2; // Blender is Z-up
    return { group, info };
  }

  global.parseBlend = parseBlend;
  global.BlendFile = BlendFile;
  global.blendDecompress = decompress;
})(typeof self !== 'undefined' ? self : globalThis);
