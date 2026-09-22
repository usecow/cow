// Cow Icons: original geometry. One coordinate system, four related treatments.
const path = d => `<path d="${d}"/>`;
const rect = (x, y, w, h, r = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
const circle = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}"/>`;
const shapes = {
  terminal: 'M5 4H19Q21 4 21 6V18Q21 20 19 20H5Q3 20 3 18V6Q3 4 5 4Z',
  file: 'M7 3H13Q14 3 15 4L19 8Q20 9 20 10V19Q20 21 18 21H7Q5 21 5 19V5Q5 3 7 3Z',
  folder: 'M5 5H9Q10 5 11 6L12 7H19Q21 7 21 9V18Q21 20 19 20H5Q3 20 3 18V7Q3 5 5 5Z',
  book: 'M5 4H10Q12 4 12 6Q12 4 14 4H19Q21 4 21 6V18Q21 19 20 19H15Q13 19 12 21Q11 19 9 19H4Q3 19 3 18V6Q3 4 5 4Z',
  message: 'M5 4H19Q21 4 21 6V15Q21 17 19 17H10L6 20Q5 21 5 19V17Q3 17 3 15V6Q3 4 5 4Z',
  heart: 'M12 20C10 18 3 14 3 8.5C3 3 9 2 12 7C15 2 21 3 21 8.5C21 14 14 18 12 20Z',
  leaf: 'M5 19C1 10 7 3 20 3C20 16 14 22 5 19Z',
  play: 'M8 4.5Q6 3.3 6 5.6V18.4Q6 20.7 8 19.5L19 13.1Q21 12 19 10.9Z',
  arrow: 'M4 10H11Q13 10 13 8V6Q13 4.5 14.2 5.5L20.6 10.7Q22.2 12 20.6 13.3L14.2 18.5Q13 19.5 13 18V16Q13 14 11 14H4Q3 14 3 13V11Q3 10 4 10Z',
};
const fileFold = path('M14 4V7Q14 9 16 9H19');
// Split the chunky arrow's outline at its two shoulder seams. Butt ends meet
// without doubled round caps, so Duo Stroke keeps the same 2-unit line weight.
const chunkyArrowSplit = {
  primary: '<path d="M13 18V16Q13 14 11 14H4Q3 14 3 13V11Q3 10 4 10H11Q13 10 13 8V6" stroke-linecap="butt"/>',
  accent: '<path d="M13 6Q13 4.5 14.2 5.5L20.6 10.7Q22.2 12 20.6 13.3L14.2 18.5Q13 19.5 13 18" stroke-linecap="butt"/>',
};

// Solids use transparent holes, not background-coloured strokes or masks.
export const icons = {
  terminal: {
    duotonePart: 'detail',
    label: 'Terminal', tags: 'command cli console',
    body: path(shapes.terminal), detail: path('M7 8L10 11L7 14M14 15H17'),
    solid: path('M5 3H19Q22 3 22 6V18Q22 21 19 21H5Q2 21 2 18V6Q2 3 5 3Z M6.3 7.3Q7 6.6 7.7 7.3L10.7 10.3Q11.4 11 10.7 11.7L7.7 14.7Q7 15.4 6.3 14.7Q5.6 14 6.3 13.3L8.6 11L6.3 8.7Q5.6 8 6.3 7.3Z M14 14H17A1 1 0 0 1 17 16H14A1 1 0 0 1 14 14Z'),
  },
  file: {
    duotonePart: 'detail',
    label: 'File', tags: 'document page source',
    body: path(shapes.file), detail: fileFold + path('M9 15H15'),
    duotoneDetail: { primary: fileFold, accent: path('M9 15H15') },
    solid: path('M7 2H13Q14.4 2 15.7 3.3L19.7 7.3Q21 8.6 21 10V19Q21 22 18 22H7Q4 22 4 19V5Q4 2 7 2Z M14 4V7Q14 9 16 9H19Z M9 14H15A1 1 0 0 1 15 16H9A1 1 0 0 1 9 14Z'),
  },
  folder: {
    duotonePart: 'detail',
    label: 'Folder', tags: 'directory files project',
    body: path(shapes.folder), detail: path('M7 12H17'),
    solid: path('M5 4H9Q10.4 4 11.7 5.3L12.4 6H19Q22 6 22 9V18Q22 21 19 21H5Q2 21 2 18V7Q2 4 5 4Z M7 11H17A1 1 0 0 1 17 13H7A1 1 0 0 1 7 11Z'),
  },
  book: {
    duotonePart: 'detail',
    label: 'Book', tags: 'documentation guide learn',
    body: path(shapes.book), detail: path('M12 6V21'),
    solid: path('M5 3H10Q12 3 12 5Q12 3 14 3H19Q22 3 22 6V18Q22 20 20 20H15Q13.6 20 12.8 21.6Q12 22.4 11.2 21.6Q10.4 20 9 20H4Q2 20 2 18V6Q2 3 5 3Z M11 7A1 1 0 0 1 13 7V18A1 1 0 0 1 11 18Z'),
  },
  message: {
    duotonePart: 'detail',
    label: 'Message', tags: 'chat discussion comment',
    body: path(shapes.message), detail: path('M8 10H16'),
    solid: path('M5 3H19Q22 3 22 6V15Q22 18 19 18H10.3L6.6 20.8Q4 23 4 19V17.8Q2 17.2 2 15V6Q2 3 5 3Z M8 9H16A1 1 0 0 1 16 11H8A1 1 0 0 1 8 9Z'),
  },
  heart: {
    label: 'Heart', tags: 'like love favorite',
    body: path(shapes.heart), detail: '',
    solid: path(shapes.heart),
    solidEdge: true,
  },
  leaf: {
    duotonePart: 'detail',
    label: 'Leaf', tags: 'grow nature clover',
    body: path(shapes.leaf), detail: path('M4 20L14 10'),
    solid: path(`${shapes.leaf} M6 16.6L13.3 9.3A1 1 0 0 1 14.7 10.7L7.4 18Z`) + path('M3.3 19.3L5.3 17.3L6.7 18.7L4.7 20.7A1 1 0 0 1 3.3 19.3Z'),
    solidEdge: true,
  },
  search: {
    duotonePart: 'detail',
    label: 'Search', tags: 'find magnify',
    body: circle(10, 10, 7), detail: path('M15 15L21 21'),
    solid: path('M15 13.6L21.7 20.3A1 1 0 0 1 20.3 21.7L13.6 15Z') + path('M18 10A8 8 0 1 1 2 10A8 8 0 1 1 18 10Z M16 10A6 6 0 1 1 4 10A6 6 0 1 1 16 10Z'),
  },
  copy: {
    duotonePart: 'detail',
    label: 'Copy', tags: 'duplicate clipboard',
    body: rect(8, 8, 13, 13), detail: path('M16 3H5Q3 3 3 5V16'),
    solid: rect(7, 7, 15, 15, 3) + path('M16 2A1 1 0 0 1 16 4H5Q4 4 4 5V16A1 1 0 0 1 2 16V5Q2 2 5 2Z'),
  },
  'arrow-right': {
    label: 'Arrow right', tags: 'next forward continue',
    body: path(shapes.arrow), detail: '',
    duotoneSplit: chunkyArrowSplit,
    solid: path(shapes.arrow),
    solidEdge: true,
  },
  check: {
    duotonePart: 'detail',
    label: 'Check', tags: 'success done confirm',
    body: circle(12, 12, 9), detail: path('M8 12L11 15L16 9'),
    solid: path('M22 12A10 10 0 1 1 2 12A10 10 0 1 1 22 12Z M7.3 11.3Q8 10.6 8.7 11.3L10.9 13.5L15.2 8.4Q15.9 7.6 16.7 8.3Q17.4 9 16.8 9.6L11.8 15.6Q11 16.4 10.3 15.7L7.3 12.7Q6.6 12 7.3 11.3Z'),
  },
  play: {
    label: 'Play', tags: 'run start execute',
    body: path(shapes.play), detail: '',
    solid: path(shapes.play),
    solidEdge: true,
  },
};

// Directional variants share their source geometry; no hand-redrawn counterparts.
const rotate = (geometry, angle) => angle ? `<g transform="rotate(${angle} 12 12)">${geometry}</g>` : geometry;
const directions = [
  ['left', 180, 'back previous west'], ['up', -90, 'north above'],
  ['down', 90, 'south below'], ['up-right', -45, 'northeast external'],
  ['down-right', 45, 'southeast'], ['down-left', 135, 'southwest'],
  ['up-left', -135, 'northwest'],
];
for (const [direction, angle, tags] of directions) {
  const base = icons['arrow-right'];
  icons[`arrow-${direction}`] = {
    label: `Arrow ${direction.replaceAll('-', ' ')}`, tags: `direction ${tags}`,
    category: 'Arrows', body: rotate(base.body, angle), detail: '',
    duotoneSplit: {
      primary: rotate(chunkyArrowSplit.primary, angle),
      accent: rotate(chunkyArrowSplit.accent, angle),
    },
    solid: rotate(base.solid, angle), solidEdge: true,
  };
}

// Expanded round-ended lines for solid controls. Separate paths union visually
// at joins rather than punching overlap holes through an even-odd compound path.
function capsule(x1, y1, x2, y2) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const dx = -(y2 - y1) / length, dy = (x2 - x1) / length;
  const n = value => Number(value.toFixed(4));
  return path(`M${n(x1 + dx)} ${n(y1 + dy)}L${n(x2 + dx)} ${n(y2 + dy)}A1 1 0 0 0 ${n(x2 - dx)} ${n(y2 - dy)}L${n(x1 - dx)} ${n(y1 - dy)}A1 1 0 0 0 ${n(x1 + dx)} ${n(y1 + dy)}Z`);
}
const lineControl = (label, tags, lines) => ({
  label, tags, category: 'Controls',
  body: path(lines.map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`).join('')),
  detail: '', solid: lines.map(line => capsule(...line)).join(''),
});
const arrowStrokeParts = ([shaft, firstBranch, secondBranch]) => ({
  stem: path(`M${shaft[0]} ${shaft[1]}L${shaft[2]} ${shaft[3]}`),
  // The two branches already share a tip. One path makes a single round join
  // over the stem cap, rather than two overlapping round caps.
  head: path(`M${firstBranch[0]} ${firstBranch[1]}L${firstBranch[2]} ${firstBranch[3]}L${secondBranch[2]} ${secondBranch[3]}`),
});

// A separate open-head family for links and buttons. All styles retain the
// same round-ended lines. Duo Stroke accents the shaft and draws the head last.
const lineArrowLines = [
  [4, 12, 20, 12], [14, 6, 20, 12], [20, 12, 14, 18],
];
const lineArrow = lineControl('Line arrow right', 'next forward east', lineArrowLines);
const lineArrowParts = arrowStrokeParts(lineArrowLines);
// In the filled treatment, bury the shaft's rounded cap inside the chevron.
// Ending it at the tip would leave a visible bulb past the two head branches.
lineArrow.solid = capsule(4,12,18,12)+capsule(14,6,20,12)+capsule(20,12,14,18);
for (const [direction, angle, tags] of [['right', 0, 'next forward east'], ...directions]) {
  icons[`arrow-line-${direction}`] = {
    label: `Line arrow ${direction.replaceAll('-', ' ')}`,
    tags: `direction simple line open link ${tags}`, category: 'Arrows',
    body: rotate(lineArrow.body, angle), detail: '',
    duotoneArrow: { stem: rotate(lineArrowParts.stem, angle), head: rotate(lineArrowParts.head, angle) },
    solid: rotate(lineArrow.solid, angle),
  };
}
// Exact grid coordinates avoid fractional endpoints from 45-degree transforms.
// The diagonal shafts remain at 45 degrees, but their open heads sit on pixels.
for (const [direction, lines, inset] of [
  ['up-right', [[5,19,19,5],[11,5,19,5],[19,5,19,13]], [5,19,18,6]],
  ['down-right', [[5,5,19,19],[11,19,19,19],[19,19,19,11]], [5,5,18,18]],
  ['down-left', [[19,5,5,19],[5,11,5,19],[5,19,13,19]], [19,5,6,18]],
  ['up-left', [[19,19,5,5],[5,13,5,5],[5,5,13,5]], [19,19,6,6]],
]) {
  const diagonal = lineControl(`Line arrow ${direction.replace('-', ' ')}`, `diagonal ${direction}`, lines);
  icons[`arrow-line-${direction}`] = {
    ...icons[`arrow-line-${direction}`], body:diagonal.body,
    duotoneArrow:arrowStrokeParts(lines),
    solid:capsule(...inset)+lines.slice(1).map(line => capsule(...line)).join(''),
  };
}

const chevron = lineControl('Chevron right', 'next expand forward', [[9, 6, 15, 12], [15, 12, 9, 18]]);
for (const [direction, angle, tags] of [['right', 0, 'next'], ['left', 180, 'previous back'], ['up', -90, 'collapse'], ['down', 90, 'expand dropdown']]) {
  icons[`chevron-${direction}`] = {
    label: `Chevron ${direction}`, tags: `direction ${tags}`, category: 'Arrows',
    body: rotate(chevron.body, angle), detail: '', solid: rotate(chevron.solid, angle),
  };
}
Object.assign(icons, {
  plus: lineControl('Plus', 'add create new increase', [[5, 12, 19, 12], [12, 5, 12, 19]]),
  minus: lineControl('Minus', 'remove subtract decrease', [[5, 12, 19, 12]]),
  close: lineControl('Close', 'dismiss cancel x', [[6, 6, 18, 18], [6, 18, 18, 6]]),
  menu: lineControl('Menu', 'hamburger navigation list', [[4, 6, 20, 6], [4, 12, 20, 12], [4, 18, 20, 18]]),
});

const tray = path('M4 17V19Q4 21 6 21H18Q20 21 20 19V17');
const solidTray = `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${tray}</g>`;
for (const [name, label, tags, lines] of [
  ['download', 'Download', 'save export receive', [[12, 3, 12, 14], [7, 9, 12, 14], [12, 14, 17, 9]]],
  ['upload', 'Upload', 'send import share', [[12, 14, 12, 3], [7, 8, 12, 3], [12, 3, 17, 8]]],
]) {
  const arrow = lineControl(label, tags, lines);
  icons[name] = { ...arrow, category: 'Arrows', detail: tray, duotoneArrow:arrowStrokeParts(lines), solid: arrow.solid + solidTray };
}
icons.refresh = {
  label: 'Refresh', tags: 'reload retry repeat sync', category: 'Arrows',
  body: path('M20 10A8 8 0 1 0 19 16M20 5L20 10L15 8'), detail: '',
  duotoneArrow:{ stem:path('M20 10A8 8 0 1 0 19 16'), head:path('M20 5L20 10L15 8') },
  // Keep the open arc open in every style; round caps match the other controls.
  solid: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path('M20 10A8 8 0 1 0 19 16M20 5L20 10L15 8')}</g>`,
};

// Open symbols keep their actual round caps and joins in solid too. A solid
// treatment need not turn an open symbol into an enclosed silhouette.
const roundStroke = geometry => `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${geometry}</g>`;
// One rounded 90-degree elbow, mirrored and rotated into every adjacent turn.
// The names describe where the shaft enters and where the arrowhead points.
const bendMaster = path('M4 4V12Q4 15 7 15H20M15 10L20 15L15 20');
const bendStem = path('M4 4V12Q4 15 7 15H20');
const bendHead = path('M15 10L20 15L15 20');
const mirrorBend = geometry => `<g transform="translate(24 0) scale(-1 1)">${geometry}</g>`;
for (const [from, to, angle, mirrored] of [
  ['top','right',0,false], ['right','down',90,false],
  ['bottom','left',180,false], ['left','up',-90,false],
  ['top','left',0,true], ['right','up',90,true],
  ['bottom','right',180,true], ['left','down',-90,true],
]) {
  const geometry = rotate(mirrored ? mirrorBend(bendMaster) : bendMaster, angle);
  icons[`arrow-bend-${from}-${to}`] = {
    label:`Bend ${from} to ${to}`,
    tags:`arrow elbow corner turn angle route ${from} ${to}`,
    category:'Arrows', body:geometry, detail:'', solid:roundStroke(geometry),
    duotoneArrow:{
      stem:rotate(mirrored ? mirrorBend(bendStem) : bendStem, angle),
      head:rotate(mirrored ? mirrorBend(bendHead) : bendHead, angle),
    },
  };
}
const openIcon = (label, tags, category, body, detail = '', duotonePart) => ({
  label, tags, category, body, detail, duotonePart,
  solid: roundStroke(body + detail),
});
Object.assign(icons, {
  code: openIcon('Code', 'source javascript typescript html syntax brackets', 'Development',
    path('M7 7L2 12L7 17M17 7L22 12L17 17'), path('M14 4L10 20'), 'detail'),
  braces: openIcon('Braces', 'object module json curly syntax', 'Development',
    path('M9 3H8Q6 3 6 5V8Q6 11 3 12Q6 13 6 16V19Q6 21 8 21H9M15 3H16Q18 3 18 5V8Q18 11 21 12Q18 13 18 16V19Q18 21 16 21H15')),
  'external-link': openIcon('External link', 'new tab window open visit outbound', 'Navigation',
    path('M10 4H6Q4 4 4 6V18Q4 20 6 20H18Q20 20 20 18V14'),
    path('M14 3H21V10M21 3L11 13'), 'detail'),
  checkmark: { ...lineControl('Checkmark', 'done success confirm tick plain', [[5,12,10,17],[10,17,19,6]]), category:'Status' },
  loader: openIcon('Loader', 'loading pending progress spinner wait', 'Status',
    path('M12 3A9 9 0 1 0 21 12')),
});

const routeLine = path('M7 5H16Q20 5 20 9Q20 12 16 12H8Q4 12 4 16Q4 19 8 19H17');
icons.route = {
  label:'Route', tags:'routing path url endpoint destination', category:'Development',
  body:routeLine, detail:circle(5,5,2)+circle(19,19,2), duotonePart:'detail',
  solid:roundStroke(routeLine)+circle(5,5,3)+circle(19,19,3),
};
icons['file-code'] = {
  label:'File code', tags:'source document script cow javascript typescript', category:'Files',
  body:icons.file.body,
  detail:fileFold+path('M10 13L8 15L10 17M14 13L16 15L14 17'),
  duotoneDetail:{ primary:fileFold, accent:path('M10 13L8 15L10 17M14 13L16 15L14 17') },
  duotonePart:'detail',
  solid:path('M7 2H13Q14.4 2 15.7 3.3L19.7 7.3Q21 8.6 21 10V19Q21 22 18 22H7Q4 22 4 19V5Q4 2 7 2Z M14 4V7Q14 9 16 9H19Z M9.3 12.3A1 1 0 0 1 10.7 13.7L9.4 15L10.7 16.3A1 1 0 0 1 9.3 17.7L7.3 15.7Q6.6 15 7.3 14.3Z M14.7 12.3L16.7 14.3Q17.4 15 16.7 15.7L14.7 17.7A1 1 0 0 1 13.3 16.3L14.6 15L13.3 13.7A1 1 0 0 1 14.7 12.3Z'),
};
icons.info = {
  label:'Info', tags:'information help note about', category:'Status',
  body:circle(12,12,9), detail:path('M12 11V17M12 7V7.1'), duotonePart:'detail',
  solid:path('M22 12A10 10 0 1 1 2 12A10 10 0 1 1 22 12Z M12 10A1 1 0 0 1 13 11V17A1 1 0 0 1 11 17V11A1 1 0 0 1 12 10Z M13 7A1 1 0 1 1 11 7A1 1 0 1 1 13 7Z'),
};
const warningShape = 'M10.3 4.3Q12 1.3 13.7 4.3L21 17.5Q22.5 20 19.5 20H4.5Q1.5 20 3 17.5Z';
icons.warning = {
  label:'Warning', tags:'alert caution error attention', category:'Status',
  body:path(warningShape), detail:path('M12 8V12M12 16V16.1'), duotonePart:'detail',
  solidEdge:true,
  solid:path(warningShape+' M12 7A1 1 0 0 1 13 8V12A1 1 0 0 1 11 12V8A1 1 0 0 1 12 7Z M13 16A1 1 0 1 1 11 16A1 1 0 1 1 13 16Z'),
};
const sunRays = path('M12 2V4M12 20V22M2 12H4M20 12H22M4.9 4.9L6.3 6.3M17.7 17.7L19.1 19.1M4.9 19.1L6.3 17.7M17.7 6.3L19.1 4.9');
icons.sun = {
  label:'Sun', tags:'light theme day brightness', category:'Nature',
  body:circle(12,12,4), detail:sunRays, duotonePart:'detail',
  solid:circle(12,12,5)+roundStroke(sunRays),
};
const moonShape = 'M20.5 14.5A9 9 0 0 1 9.5 3.5Q10 2.5 8.8 3A9.2 9.2 0 1 0 21 15.2Q21.5 14 20.5 14.5Z';
icons.moon = {
  label:'Moon', tags:'dark theme night sleep', category:'Nature',
  body:path(moonShape), detail:'', solid:path(moonShape), solidEdge:true,
};

// Site capabilities and documentation. Keep these ordinary UI symbols distinct
// from the mascot, and reuse the file family where a document is involved.
const formShape = 'M6 3H18Q20 3 20 5V19Q20 21 18 21H6Q4 21 4 19V5Q4 3 6 3Z';
icons.form = {
  label:'Form', tags:'input fields submit html upload', category:'Development',
  body:path(formShape), detail:path('M8 8H12')+rect(8,12,8,4,1), duotonePart:'detail',
  solid:path('M6 2H18Q21 2 21 5V19Q21 22 18 22H6Q3 22 3 19V5Q3 2 6 2Z M8 7H12A1 1 0 0 1 12 9H8A1 1 0 0 1 8 7Z M8 11H16Q17 11 17 12V16Q17 17 16 17H8Q7 17 7 16V12Q7 11 8 11Z'),
};
const cookieShape = 'M20.5 12.5A9 9 0 1 1 11.5 3.5Q12 7.5 15.5 7.5Q15.5 11.5 20.5 12.5Z';
const cookieChips = `<g fill="currentColor" stroke="none">${circle(8,10,1)+circle(14,13,1)+circle(10,17,1)}</g>`;
icons.cookie = {
  label:'Cookie', tags:'browser cookies session preference', category:'Development',
  body:path(cookieShape), detail:cookieChips, duotonePart:'detail',
  solid:path(cookieShape+' M9 10A1 1 0 1 1 7 10A1 1 0 1 1 9 10Z M15 13A1 1 0 1 1 13 13A1 1 0 1 1 15 13Z M11 17A1 1 0 1 1 9 17A1 1 0 1 1 11 17Z'),
  solidEdge:true,
};
const lockShackle = path('M7 10V7Q7 3 12 3Q17 3 17 7V10');
const lockBody = rect(4,10,16,11,3);
const lockFace = 'M7 9H17Q21 9 21 13V18Q21 22 17 22H7Q3 22 3 18V13Q3 9 7 9Z';
const lockHole = 'M12 13A1 1 0 0 1 13 14V17A1 1 0 0 1 11 17V14A1 1 0 0 1 12 13Z';
icons.lock = {
  label:'Lock', tags:'secure private access sessions authentication', category:'Status',
  body:lockShackle+lockBody, detail:path('M12 14V17'), duotonePart:'detail',
  solid:roundStroke(lockShackle)+path(`${lockFace} ${lockHole}`),
};
const databaseShape = 'M12 3C7 3 4 5 4 7V17Q4 21 12 21Q20 21 20 17V7C20 5 17 3 12 3Z';
const databaseBands = path('M4 8Q12 12 20 8M4 13Q12 17 20 13');
icons.database = {
  label:'Database', tags:'sqlite sql storage records data', category:'Development',
  body:path(databaseShape), detail:databaseBands, duotonePart:'detail',
  solid:path('M12 2C6 2 3 4 3 7V17Q3 22 12 22Q21 22 21 17V7C21 4 18 2 12 2Z M4 8Q12 12 20 8V10Q12 14 4 10Z M4 13Q12 17 20 13V15Q12 19 4 15Z'),
};
const moduleShape = 'M12 3L20 7V17L12 21L4 17V7Z';
const moduleSeams = path('M4 7L12 11L20 7M12 11V21');
icons.module = {
  label:'Module', tags:'package import reusable code cow module', category:'Development',
  body:path(moduleShape), detail:moduleSeams, duotonePart:'detail',
  // Duo Stroke is a front-facing line cube. The accent depth is painted last,
  // and no primary segment runs beneath it or doubles its line weight.
  duotoneGeometry:path('M3 7H16V20H3Z')
    +`<g stroke="var(--cow-icon-accent, #456329)">${path('M3 7L8 3H21V16L16 20')+path('M16 7L21 3')}</g>`,
  solid:path('M12 2L21 6.5V17.5L12 22L3 17.5V6.5Z M4 7.5L12 11.5L20 7.5V9.5L13 13V21H11V13L4 9.5Z'),
};
const browserFrame = rect(3,4,18,16,3);
const browserTop = path('M3 9H21');
const browserInner = path('M7 14H15');
const browserDetails = browserTop + browserInner;
icons.browser = {
  label:'Browser', tags:'web page window site preview response', category:'Navigation',
  body:browserFrame, detail:browserDetails, duotonePart:'detail',
  duotoneDetail:{ primary:browserTop, accent:browserInner },
  solid:path('M6 3H18Q22 3 22 7V17Q22 21 18 21H6Q2 21 2 17V7Q2 3 6 3Z M3 9H21V11H3Z M7 13H15A1 1 0 0 1 15 15H7A1 1 0 0 1 7 13Z'),
};
const userHead = circle(12,8,4);
const userShoulders = path('M4 20V18Q4 14 12 14Q20 14 20 18V20');
icons.user = {
  label:'User', tags:'person account profile member author', category:'Communication',
  body:userHead+userShoulders, detail:'',
  solid:circle(12,8,5)+path('M8 13H16Q21 13 21 18V20Q21 21 20 21H4Q3 21 3 20V18Q3 13 8 13Z'),
};
const jsonBraces = path('M11 12H10Q9 12 9 13V14Q9 15 8 15Q9 15 9 16V17Q9 18 10 18H11M14 12H15Q16 12 16 13V14Q16 15 17 15Q16 15 16 16V17Q16 18 15 18H14');
icons['file-json'] = {
  label:'JSON file', tags:'json response data document api', category:'Files',
  body:icons.file.body,
  detail:fileFold+jsonBraces, duotonePart:'detail',
  duotoneDetail:{ primary:fileFold, accent:jsonBraces },
  solid:path('M7 2H13Q14.4 2 15.7 3.3L19.7 7.3Q21 8.6 21 10V19Q21 22 18 22H7Q4 22 4 19V5Q4 2 7 2Z M14 4V7Q14 9 16 9H19Z M11 11H10Q8 11 8 13V14Q8 15 7 15Q8 15 8 16V17Q8 19 10 19H11V17H10V16Q11 15 10 14V13H11Z M14 11H15Q17 11 17 13V14Q17 15 18 15Q17 15 17 16V17Q17 19 15 19H14V17H15V16Q14 15 15 14V13H14Z'),
};
const keyHead = circle(8,8,5);
const keyTeeth = path('M11 11L20 20M16 16L18 14M18 18L20 16');
const solidKeyTeeth = capsule(11,11,20,20)+capsule(16,16,18,14)+capsule(18,18,20,16);
icons.key = {
  label:'Key', tags:'credential access secret account setup', category:'Status',
  body:keyHead, detail:keyTeeth, duotonePart:'detail',
  solid:path('M14 8A6 6 0 1 1 2 8A6 6 0 1 1 14 8Z M11 8A3 3 0 1 1 5 8A3 3 0 1 1 11 8Z')
    +solidKeyTeeth,
};

// Cow-specific symbols. The UI head keeps the mascot's asymmetric
// horns, floppy ear, projecting muzzle and long neck, without the logo disc.
// This is a small UI adaptation, not a replacement for assets/cow-mark.svg.
const cowHead = 'M5 21L7 12Q3 13 3 10Q3 8 7 8L7 4Q8 3 10 6Q12 5 14 6L15 3Q17 4 17 8C17 10 22 9 22 13Q22 17 15 17L13 21Z';
icons['cow-mark'] = {
  label:'Cow mark', tags:'mascot brand cow language head', category:'Cow',
  // Stroke follows the open neck contour; the other styles retain the stamp.
  strokeGeometry:path(cowHead.slice(0,-1)),
  body:`<g fill="currentColor" stroke="none">${path(cowHead)}</g>`, detail:'',
  solid:path(cowHead),
};

// Center the shared head beneath the fold. A silhouette stamp avoids adding
// another miniature outline; the solid page uses the exact same shape as a hole.
let fileMarkCoordinate = 0;
const fileMark = cowHead.replace(/\d*\.?\d+/g, value =>
  String(Number((Number(value) * .45 + (fileMarkCoordinate++ % 2 ? 9.5 : 6.875)).toFixed(3))));
icons['cow-file'] = {
  label:'Cow file', tags:'cow source script document file extension', category:'Cow',
  body:icons.file.body,
  detail:fileFold+`<g fill="currentColor" stroke="none">${path(fileMark)}</g>`, duotonePart:'detail',
  duotoneDetail:{ primary:fileFold, accent:`<g fill="currentColor" stroke="none">${path(fileMark)}</g>` },
  solid:path('M7 2H13Q14.4 2 15.7 3.3L19.7 7.3Q21 8.6 21 10V19Q21 22 18 22H7Q4 22 4 19V5Q4 2 7 2Z M14 4V7Q14 9 16 9H19Z '+fileMark),
};
const cowSpots = 'M5 4C8 2 12 4 11 7C10.5 8.5 8.5 8 8 10C7.5 12 3 12 3 9Q2.5 6 5 4Z M16 13C18 11 21 13 21 16C21 19 18 22 15 20Q12 19 14 17Q15.5 16 16 13Z';
icons.spots = {
  label:'Spots', tags:'cow patches appearance pattern theme', category:'Cow',
  body:path(cowSpots), detail:'', solid:path(cowSpots), solidEdge:true,
};
const hoof = 'M10 4C6 3 3 11 3 16Q3 20 7 20Q10 20 10 17Z M14 4C18 3 21 11 21 16Q21 20 17 20Q14 20 14 17Z';
icons.hoofprint = {
  label:'Hoofprint', tags:'cow hoof footprint steps start example trail', category:'Cow',
  body:path(hoof), detail:'', solid:path(hoof), solidEdge:true,
};
const milkBottle = 'M9 2H15Q16 2 16 3V4Q16 5 15 5V6C15 7.5 18 8 18 10V19Q18 21 16 21H8Q6 21 6 19V10C6 8 9 7.5 9 6V5Q8 5 8 4V3Q8 2 9 2Z';
icons['milk-bottle'] = {
  label:'Milk bottle', tags:'cow milk goodies extras bottle', category:'Cow',
  body:path(milkBottle), detail:path('M9 5H15M6 14C10 12 14 16 18 14'), duotonePart:'detail',
  solidEdge:true,
  solid:path(milkBottle+' M9 4H15A1 1 0 0 1 15 6H9A1 1 0 0 1 9 4Z M7 13C10 11.5 14 15.5 17 13V15C14 17.5 10 13.5 7 15Z'),
};

// Bake the front head's coordinates into the grid instead of scaling its
// stroke. The customizer and exported solids then retain the same line weight.
// cowHead contains only absolute M/L/Q/C coordinate pairs and Z.
let herdCoordinate = 0;
const herdHead = cowHead.replace(/\d*\.?\d+/g, value =>
  String(Number((Number(value) * .68 + (herdCoordinate++ % 2 ? 7 : 6)).toFixed(3))));
// Rear cow faces left. Its visible contour mirrors the shared head at the
// same scale as the foreground cow; the neck is hidden behind that cow.
// Only the exposed contour is drawn, with no background-coloured erasing.
const herdRear = path('M12.54 8.16Q15.26 8.84 15.26 6.8Q15.26 5.44 12.54 5.44L12.54 2.72Q11.86 2.04 10.5 4.08Q9.14 3.4 7.78 4.08L7.1 2.04Q5.74 2.72 5.74 5.44C5.74 6.8 2.34 6.12 2.34 8.84Q2.34 11.56 7.1 11.56');
const herdRearFill = path('M12.54 8.16Q15.26 8.84 15.26 6.8Q15.26 5.44 12.54 5.44L12.54 2.72Q11.86 2.04 10.5 4.08Q9.14 3.4 7.78 4.08L7.1 2.04Q5.74 2.72 5.74 5.44C5.74 6.8 2.34 6.12 2.34 8.84Q2.34 11.56 7.1 11.56L6 15H14.5Z');
icons.herd = {
  label:'Herd', tags:'cow community team people together', category:'Cow',
  body:herdRear,
  detail:path(herdHead), duotonePart:'body',
  solid:roundStroke(herdRear+path(herdHead))+path(herdHead),
};

// Duo Solid has its own art direction and back-to-front layer order. Sharing
// contours does not mean inheriting Duo Stroke's body/detail colour assignment.
const solidParts = name => {
  const [outer, ...cutouts] = icons[name].solid.match(/^<path d="([^"]+)"\/>$/)[1].split(/ (?=M)/);
  return { surface:path(outer), inlays:path(cutouts.join(' ')) };
};
const surface = name => solidParts(name).surface;
const inlays = name => solidParts(name).inlays;
const primary = geometry => ({ tone:'primary', geometry });
const secondary = geometry => ({ tone:'secondary', geometry });
const solidPaths = name => icons[name].solid.match(/<path d="[^"]+"\/>/g);
// Filled accent surfaces retain the same centered 2-unit contour as Stroke.
// This adds definition without changing the canonical silhouette or line weight.
const outlinedFill = name => [secondary(surface(name)), primary(roundStroke(icons[name].body)+inlays(name))];
// Closed silhouettes can use the accent as their whole fill, with the same
// primary 2-unit edge rather than an arbitrary second-colour patch.
const accentSilhouette = (name, contour = icons[name].body) =>
  [secondary(icons[name].solid), primary(roundStroke(contour))];
const duoSolidCompositions = {
  terminal:outlinedFill('terminal'),
  file:outlinedFill('file'),
  'file-code':outlinedFill('file-code'),
  'cow-file':outlinedFill('cow-file'),
  'file-json':outlinedFill('file-json'),
  form:outlinedFill('form'),
  cookie:[secondary(surface('cookie')), primary(roundStroke(icons.cookie.body)+inlays('cookie'))],
  lock:[primary(roundStroke(lockShackle)), secondary(path(lockFace)), primary(roundStroke(lockBody+icons.lock.detail))],
  database:outlinedFill('database'),
  // Front-facing cube: an open square front, filled top/right depth faces,
  // and one normal-weight contour around the exterior and face seams.
  module:[
    secondary(path('M3 7L8 3H21L16 7Z')+path('M16 7L21 3V16L16 20Z')),
    primary(roundStroke(path('M3 7L8 3H21V16L16 20H3Z')+path('M3 7H16L21 3M16 7V20'))),
  ],
  browser:outlinedFill('browser'),
  key:[
    secondary(circle(8,8,4)),
    primary(path('M14 8A6 6 0 1 1 2 8A6 6 0 1 1 14 8Z M12 8A4 4 0 1 1 4 8A4 4 0 1 1 12 8Z')+solidKeyTeeth),
  ],
  // The rear tab sits behind the front panel; the inset retains its position.
  folder:[secondary(surface('folder')), primary(path('M2 9H22V18Q22 21 19 21H5Q2 21 2 18Z M7 11H17A1 1 0 0 1 17 13H7A1 1 0 0 1 7 11Z'))],
  book:outlinedFill('book'),
  message:outlinedFill('message'),
  check:outlinedFill('check'),
  info:outlinedFill('info'),
  warning:outlinedFill('warning'),
  // Put the handle behind the rim, not across its foreground edge.
  search:[secondary(circle(10,10,7)), primary(roundStroke(icons.search.body)+solidPaths('search')[0])],
  copy:[primary(solidPaths('copy')[0]), secondary(rect(7, 7, 15, 15, 3)), primary(roundStroke(icons.copy.body))],
  // One continuous vein becomes the stem; there is no detached inlay.
  leaf:[secondary(path(shapes.leaf)), primary(roundStroke(icons.leaf.body)+capsule(4,20,14,10))],
  download:[primary(solidTray), secondary(icons.download.solid.slice(0, -solidTray.length))],
  upload:[primary(solidTray), secondary(icons.upload.solid.slice(0, -solidTray.length))],
  'external-link':[secondary(rect(3, 6, 15, 15, 3)), primary(roundStroke(rect(4, 7, 13, 13, 2)+icons['external-link'].detail))],
  route:[secondary(roundStroke(routeLine)), primary(circle(5,5,3)+circle(19,19,3))],
  sun:[secondary(circle(12,12,5)), primary(roundStroke(sunRays))],
  'milk-bottle':[
    primary(path(milkBottle)),
    // Milk is a volume below a gently curved surface, not a floating stripe.
    secondary(path('M7 14C10 12 14 16 17 14V19Q17 20 16 20H8Q7 20 7 19Z')),
    primary(roundStroke(path(milkBottle)+path('M7 14C10 12 14 16 17 14'))),
    primary(path('M9 2H15Q16 2 16 3V4Q16 5 15 5H9Q8 5 8 4V3Q8 2 9 2Z')),
  ],
  herd:[secondary(herdRearFill), primary(path(herdHead))],
  heart:accentSilhouette('heart'),
  play:accentSilhouette('play'),
  moon:accentSilhouette('moon'),
  // Match User's open bust edge: retain the flat accent-filled base, but do
  // not draw a primary closing stroke across the Cow mark's neck.
  'cow-mark':accentSilhouette('cow-mark', path(cowHead.slice(0,-1))),
  hoofprint:accentSilhouette('hoofprint'),
  spots:accentSilhouette('spots'),
  user:accentSilhouette('user'),
};
for (const name of ['arrow-right', ...directions.map(([direction]) => `arrow-${direction}`)]) {
  duoSolidCompositions[name] = accentSilhouette(name);
}

export const variants = ['stroke', 'solid', 'duotone', 'duotone-solid'];
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Returns inline SVG. Decorative by default; pass a label for a standalone image. */
export function cowIcon(name, { variant = 'stroke', size = 24, label } = {}) {
  if (!Object.hasOwn(icons, name)) throw new Error(`Unknown Cow icon: ${name}`);
  if (!variants.includes(variant)) throw new Error(`Unknown Cow icon variant: ${variant}`);
  if (!Number.isFinite(size) || size < 1) throw new Error('Icon size must be a positive number');
  const icon = icons[name];
  const a11y = label ? `role="img" aria-label="${escape(label)}"` : 'aria-hidden="true"';
  // Recolour existing parts only. Duotone cannot add, remove, or fill geometry.
  const accent = part => variant === 'duotone' && icon.duotonePart === part;
  const paint = (part, geometry) => accent(part)
    ? `<g stroke="var(--cow-icon-accent, #456329)">${geometry.replaceAll('fill="currentColor"', 'fill="var(--cow-icon-accent, #456329)"')}</g>`
    : geometry;
  const detail = variant === 'duotone' && icon.duotoneDetail
    ? icon.duotoneDetail.primary + paint('detail', icon.duotoneDetail.accent)
    : paint('detail', icon.detail);
  const outlineGeometry = variant === 'stroke' && icon.strokeGeometry
    ? icon.strokeGeometry
    : variant === 'duotone' && icon.duotoneGeometry
    ? icon.duotoneGeometry
    : variant === 'duotone' && icon.duotoneSplit
      ? `${icon.duotoneSplit.primary}<g stroke="var(--cow-icon-accent, #456329)">${icon.duotoneSplit.accent}</g>${detail}`
      : variant === 'duotone' && icon.duotoneArrow
        ? `<g stroke="var(--cow-icon-accent, #456329)">${icon.duotoneArrow.stem}</g>${icon.duotoneArrow.head}${detail}`
        : paint('body', icon.body) + detail;
  const outline = `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${outlineGeometry}</g>`;
  // Organic silhouettes keep the exact outer stroke edge. Interior cutouts
  // remain inset from this rim and genuinely transparent on every background.
  // A Duo Solid icon without a two-layer composition uses the accent alone.
  // Keep the geometry and weight identical to Solid; only its tone changes.
  const solidTone = variant === 'duotone-solid' ? 'var(--cow-icon-accent, #688e43)' : 'currentColor';
  const solidEdge = icon.solidEdge ? `<g fill="none" stroke="${solidTone}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon.body.replaceAll('="currentColor"', `="${solidTone}"`)}</g>` : '';
  let drawing = variant === 'solid' || variant === 'duotone-solid'
    ? `${solidEdge}<g fill="${solidTone}" fill-rule="evenodd">${icon.solid.replaceAll('="currentColor"', `="${solidTone}"`)}</g>`
    : outline;
  if (variant === 'duotone-solid' && duoSolidCompositions[name]) {
    drawing = duoSolidCompositions[name].map(layer => {
      const color = layer.tone === 'secondary' ? 'var(--cow-icon-accent, #688e43)' : 'currentColor';
      const geometry = layer.geometry.replaceAll('="currentColor"', `="${color}"`);
      return `<g fill="${color}" fill-rule="evenodd">${geometry}</g>`;
    }).join('');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ${a11y} focusable="false" data-cow-icon="${name}" data-variant="${variant}">${drawing}</svg>`;
}
