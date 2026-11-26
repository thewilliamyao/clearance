// Every line of text the unit shows, screen by screen, in the Office's words. The controller
// (editor/) edits them; William's edits live in content/edits.json and replace these at boot
// (content.js). The shift memos and the requests' wording are in days.js and requests.js.
//
// {NAME} in a line is filled in by the game when it draws it; {RECORDER} and {UNIT} work in
// every line. Each line says where it shows (`where`), the box it has to fit in screen pixels
// (`fit`: w wide, at most `lines` lines when it wraps, one line otherwise; `scale` for big
// type), sample values for its placeholders (`vars`, for the controller's previews), and the
// shift it belongs to when it only shows on one (`shift`).

const L = (text, where, fit, vars = {}, more = {}) => ({ text, where, fit, vars, ...more });
const MENU_W = 132; // the title menu is the narrowest list a menu item appears in

export const GROUPS = [
  { id: 'global', name: 'Everywhere', note: 'Names used across the game.', lines: {
    recorder: L('3-17', 'The Recorder\'s number. Every {RECORDER} in a line shows this.', { w: 60 }),
    unit: L('OCR-7', 'The unit\'s model name, bottom right of the title. Every {UNIT} in a line shows this.', { w: 60 }),
    office: L('OFFICE OF CIVIC RECORD', 'Top line of every Office document (work order, report, requisitions, endings).', { w: 240 }),
    recorderLine: L('RECORDER {RECORDER}', 'Top right of the shift report and the endings, and the second line of the final FILED stamp.', { w: 120 }),
  } },
  { id: 'title', name: 'Title', lines: {
    word: L('CLEARANCE', 'The game\'s name, big, under the seal. Also on the last screen of the open-back ending.', { w: 300, scale: 4 }),
    subtitle: L('A FIELD UNIT OF THE OFFICE OF CIVIC RECORD', 'Under the name.', { w: 312 }),
    report: L('REPORT FOR DUTY', 'Menu, first time.', { w: MENU_W }),
    resume: L('RESUME SHIFT {SHIFT}', 'Menu, during a game.', { w: MENU_W }, { SHIFT: 3 }),
    again: L('BEGIN AGAIN', 'Menu, after an ending.', { w: MENU_W }),
    newRecorder: L('NEW RECORDER', 'Menu, during a game: start over.', { w: MENU_W }),
    startOver: L('START OVER AS A NEW RECORDER? YOUR SHIFTS, MERIT AND EVERY EXPOSURE WILL BE DELETED.', 'Question after NEW RECORDER.', { w: 236, lines: 8 }),
    startOverYes: L('START OVER', 'Its yes button.', { w: 100 }),
    startOverNo: L('KEEP', 'Its no button.', { w: 100 }),
    camWaiting: L('WAITING FOR CAMERA PERMISSION', 'While the browser asks for the camera.', { w: 312 }),
    camOff: L('TOUCH ANY BUTTON TO WAKE THE UNIT', 'Before the camera starts.', { w: 312 }),
    hints: L('▴▾ CHOOSE   ● OK', 'Bottom of the title screen.', { w: 312 }),
  } },
  { id: 'order', name: 'Work order', note: 'The memo, the shift\'s name and the issue note are on each shift\'s page.', lines: {
    title: L('WORK ORDER · SHIFT {SHIFT} OF {SHIFTS} · {NAME}', 'Header of the work order.', { w: 267 }, { SHIFT: 3, SHIFTS: 7, NAME: 'CENSUS' }),
    modules: L('MODULES: {LIST}', 'Which recognition modules the unit has this shift.', { w: 284, lines: 2 }, { LIST: 'CHROMA · FORM · INVENTORY · CENSUS' }),
    requests: L('REQUESTS · FILE ANY {QUOTA} OF {N}', 'Above the list of requests.', { w: 284 }, { QUOTA: 3, N: 6 }),
    filed: L('FILED +{MERIT}', 'Right of a request already filed.', { w: 70 }, { MERIT: 33 }),
    withdrawn: L('WITHDRAWN', 'Right of a request the Recorder refused (shift 5), here and on the shift report.', { w: 70 }),
    film: L('FILM: {FILM} EXPOSURES   MERIT ON HAND: {MERIT}', 'Under the requests.', { w: 284 }, { FILM: 10, MERIT: 245 }),
    accept: L('● ACCEPT ORDER', 'Bottom left, blinking, when the order is new.', { w: 200 }),
    back: L('● BACK TO WORK', 'Bottom left when the order is opened from the menu.', { w: 200 }),
    stamp: L('ISSUED', 'The red stamp on a new order.', { w: 110, scale: 2 }),
  } },
  { id: 'field', name: 'Viewfinder', lines: {
    firstHint: L('FRAME THE SUBJECT IN THE BRACKETS AND PRESS THE SHUTTER.\n▴ ▾ PICKS THE REQUEST · SELECT OPENS THE MENU', 'Notice over the picture the first time in the field (shift 1 only).', { w: 240, lines: 4 }, {}, { shift: 1 }),
    selfHint: L('HINT: THE RECORDER IS HOLDING THE UNIT.', 'Shift 7, after two photos that missed THE RECORDER.', { w: 240, lines: 3 }, {}, { shift: 7 }),
    selfHint2: L('TURN THE UNIT AROUND.', 'Shift 7, after four misses.', { w: 240, lines: 3 }, {}, { shift: 7 }),
    noZoom: L('LENS I HAS NO ZOOM · REQUISITION LENS II', 'Notice when ◂ ▸ is pressed without a zoom lens.', { w: 240, lines: 2 }),
    noPicture: L('NO PICTURE · CHECK THE CAMERA', 'Notice when the shutter is pressed with no camera picture.', { w: 240, lines: 2 }),
    noOrder: L('NO WORK ORDER', 'Top left when there is no work order.', { w: 200 }),
    hudOff: L('WORK ORDER HIDDEN · OK SHOWS IT', 'Notice when OK hides the work order and the bottom bar (they come back with OK, a new shift, or resuming).', { w: 240, lines: 2 }),
    toFile: L('FILE {LEFT} MORE · {FILED}/{QUOTA}', 'Header of the request list, top left.', { w: 200 }, { LEFT: 2, FILED: 1, QUOTA: 3 }),
    quotaMet: L('QUOTA MET · {FILED} FILED', 'Header of the request list once the quota is met (in red).', { w: 200 }, { FILED: 3 }),
    shoot: L('✓ {WHAT} · SHOOT', 'Line under the list when the live check sees what the request wants (colours, shapes, light, NOTHING, symmetry).', { w: 312 }, { WHAT: 'RED IN BRACKETS 12%' }),
    film: L('FILM {N}', 'Bottom bar, left (blinks red at 2 or less, and flashes after a photo that leaves fewer than the open requests + 2).', { w: 56 }, { N: '09' }),
    merit: L('MERIT {MERIT}', 'Bottom bar, next to the film count.', { w: 90 }, { MERIT: 245 }),
    from: L('THE OFFICE', 'Who the speech bubble is from (quota met, out of film).', { w: 174 }),
    quotaTitle: L('QUOTA MET', 'Bubble title when the quota is met (red).', { w: 174 }),
    quotaBody: L('{FILED} OF {N} REQUESTS FILED. RETURN FOR REVIEW NOW AND COLLECT A +{BONUS} DILIGENCE BONUS.', 'Bubble text when the quota is met.', { w: 172, lines: 6 }, { FILED: 4, N: 6, BONUS: 24 }),
    filmTitle: L('OUT OF FILM', 'Bubble title when the film runs out.', { w: 174 }),
    filmBody: L('NO EXPOSURES LEFT ON THIS SHIFT. RETURN FOR REVIEW.', 'Bubble text when the film runs out.', { w: 172, lines: 6 }),
    endShift: L('END SHIFT', 'Bubble button.', { w: 75 }),
    keepShooting: L('KEEP SHOOTING', 'Bubble button (quota met).', { w: 75 }),
  } },
  { id: 'ask', name: 'Shift 5: YOU SURE?', note: 'The bubble the INTENT module puts up the first time a shift 5 request is shot. Each request\'s own question ("OH, SO THAT\'S SADNESS?") is on the shift 5 page.', lines: {
    from: L('INTENT', 'Who the bubble is from.', { w: 174 }, {}, { shift: 5 }),
    title: L('YOU SURE?', 'Bubble title (red).', { w: 174 }, {}, { shift: 5 }),
    showAgain: L('SHOW AGAIN', 'Left button: the next photo for this request files.', { w: 75 }, {}, { shift: 5 }),
    no: L('NO', 'Right button: the Recorder takes the judgement back.', { w: 75 }, {}, { shift: 5 }),
    withdrawn: L('JUDGEMENT WITHDRAWN', 'Notice after NO.', { w: 240, lines: 2 }, {}, { shift: 5 }),
  } },
  { id: 'develop', name: 'Develop', note: 'The print, its stamp and the readout after each photo.', lines: {
    analysing: L('ANALYSING EXPOSURE', 'Blinks while the modules look at the photo.', { w: 240, lines: 2 }),
    filed: L('FILED', 'Big red stamp when a photo meets the request.', { w: 150, scale: 3 }),
    merit: L('+{MERIT} MERIT', 'Bottom line of the FILED stamp.', { w: 150, scale: 2 }, { MERIT: 33 }),
    notFiled: L('NOT FILED', 'Red stamp when it doesn\'t. Under it: the reason (Not filed page).', { w: 150, scale: 2 }),
    noRequest: L('NO OPEN REQUEST', 'Reason when every request is done.', { w: 250 }),
    continue: L('● CONTINUE', 'Top right once the stamp is down. Also on the endings.', { w: 150 }),
    shared: L('SHARED · INDEX {NO}', 'Under ● CONTINUE when the print went to the shared index.', { w: 200 }, { NO: '0042' }),
    sending: L('SENDING TO THE INDEX', 'Same place, while it goes.', { w: 200 }),
    queued: L('QUEUED FOR THE INDEX', 'Same place, when it waits for a connection.', { w: 200 }),
  } },
  { id: 'verdict', name: 'Not filed reasons', note: 'What the NOT FILED stamp says, and the live line under the request list. The numbers come from the modules.', lines: {
    notInstalled: L('{MODULE} MODULE NOT INSTALLED', 'A request needs a module the unit doesn\'t have yet.', { w: 250 }, { MODULE: 'INVENTORY' }),
    colour: L('{COLOUR} IN BRACKETS {HAVE} · NEED {NEED}', 'Colour requests.', { w: 250 }, { COLOUR: 'RED', HAVE: '5%', NEED: '8%' }),
    shapeOutside: L('{SHAPE} OUTSIDE THE BRACKETS', 'A shape was found, but not in the middle.', { w: 250 }, { SHAPE: 'CIRCLE' }),
    noRect: L('NO RECTANGLE · GET ALL FOUR SIDES IN THE FRAME', 'A RECTANGLE: none found.', { w: 250 }),
    noShape: L('NO CLEAN {SHAPE} · FRAME ONE SHAPE ON A PLAIN GROUND', 'A CIRCLE / A TRIANGLE: none found.', { w: 250 }, { SHAPE: 'CIRCLE' }),
    shapeScore: L('{SHAPE} {SCORE} · NEED {NEED}', 'A shape that is not clean enough.', { w: 250 }, { SHAPE: 'RECTANGLE', SCORE: '.52', NEED: '.60' }),
    symmetry: L('SYMMETRY {HAVE} · NEED {NEED}', 'SOMETHING SYMMETRICAL.', { w: 250 }, { HAVE: '.71', NEED: '.82' }),
    lightOk: L('LIGHT SOURCE IN FRAME', 'A SOURCE OF LIGHT: found (live line).', { w: 250 }),
    noLight: L('NO LIGHT SOURCE IN FRAME', 'A SOURCE OF LIGHT: none.', { w: 250 }),
    tooBright: L('TOO MUCH LIGHT · FRAME A LAMP IN THE DARK', 'A SOURCE OF LIGHT: everything is bright.', { w: 250 }),
    nothingOk: L('NOTHING IN FRAME', 'NOTHING: met (live line). Also: a shift 5 "something" request shot at nothing.', { w: 250 }),
    something: L('SOMETHING IS IN THE FRAME', 'NOTHING: not met.', { w: 250 }),
    noThing: L('NO {WHAT} ON RECORD', 'Object requests: none of the things found.', { w: 250 }, { WHAT: 'CLOCK' }),
    noSubject: L('NO SUBJECT ON RECORD', 'A request about people, and nobody found.', { w: 250 }),
    subjectNoThing: L('SUBJECT FOUND, NO {WHAT}', 'SOMEONE WITH (a bag, a phone, an animal): a person but not the thing.', { w: 250 }, { WHAT: 'BAG' }),
    count: L('{HAVE} OF {NEED} SUBJECTS', 'TWO PEOPLE, A CROWD: how many were counted.', { w: 250 }, { HAVE: 1, NEED: 2 }),
    noFaceFound: L('NO FACE FOUND · WITHIN 2 METRES', 'A FACE: none found.', { w: 250 }),
    tooClose: L('SUBJECT TOO CLOSE', 'SOMEONE FAR AWAY: the person is too big in the frame.', { w: 250 }),
    noReadableFace: L('NO READABLE FACE · GET CLOSER', 'Sentiment requests: no face close enough to read.', { w: 250 }),
    joy: L('JOY {HAVE} · NEED {NEED}', 'SOMEONE SMILING.', { w: 250 }, { HAVE: '12%', NEED: '36%' }),
    noJoy: L('JOY {HAVE} · MUST BE UNDER {MAX}', 'SOMEONE NOT SMILING.', { w: 250 }, { HAVE: '40%', MAX: '10%' }),
    eyes: L('EYES CLOSED {HAVE} · NEED {NEED}', 'SOMEONE WITH THEIR EYES CLOSED.', { w: 250 }, { HAVE: '8%', NEED: '40%' }),
    away: L('HEAD TURNED {DEG}° · NEED {NEED}°', 'SOMEONE LOOKING AWAY.', { w: 250 }, { DEG: 6, NEED: 19 }),
    atYou: L('HEAD TURNED {DEG}° · MUST FACE THE LENS', 'SOMEONE LOOKING AT YOU.', { w: 250 }, { DEG: 30 }),
    surprise: L('SURPRISE {HAVE} · NEED {NEED}', 'SOMEONE SURPRISED.', { w: 250 }, { HAVE: '10%', NEED: '40%' }),
    alone: L('{N} SUBJECTS IN FRAME · NEED ONE, ALONE', 'SOMEONE ALONE with more than one person.', { w: 250 }, { N: 2 }),
    faceNotPlace: L('A FACE IS NOT A PLACE · STEP BACK', 'A PLACE TO HIDE shot at a face.', { w: 250 }),
    notOnFile: L('EXPOSURE NOT ON FILE', 'THE SUBJECT OF EXPOSURE #N AGAIN, when that photo is gone.', { w: 250 }),
    match: L('MATCH {HAVE} · NEED {NEED}', 'THE SUBJECT OF EXPOSURE #N AGAIN.', { w: 250 }, { HAVE: '61%', NEED: '72%' }),
    bestMatch: L('BEST MATCH {HAVE} · NEED {NEED}', 'A PLACE YOU HAVE BEEN, SOMEONE YOU PHOTOGRAPHED BEFORE.', { w: 250 }, { HAVE: '64%', NEED: '72%' }),
    watching: L('THE SUBJECT IS LOOKING AT YOU', 'SOMEONE WHO HAS NOT NOTICED YOU, when they have.', { w: 250 }),
    noRecorder: L('THE RECORDER IS NOT IN FRAME', 'Shift 7: no face.', { w: 250 }, {}, { shift: 7 }),
    recorderFar: L('TOO FAR · THE RECORDER IS CLOSER THAN THAT', 'Shift 7: a face, but too small.', { w: 250 }, {}, { shift: 7 }),
    fault: L('MODULE FAULT', 'A module crashed on this photo.', { w: 250 }),
    subject: L('SUBJECT', 'Tag on the box around the person a request is about.', { w: 120 }),
    subjectN: L('SUBJ {N}', 'Tags on counted people and live face boxes.', { w: 60 }, { N: '01' }),
    distant: L('DISTANT SUBJECT', 'Tag for SOMEONE FAR AWAY.', { w: 120 }),
    unaware: L('UNAWARE SUBJECT', 'Tag for SOMEONE WHO HAS NOT NOTICED YOU.', { w: 120 }),
  } },
  { id: 'menu', name: 'Menu and questions', note: 'The menu SELECT opens in the field (LAB, THE INDEX and SETTINGS are also on the title screen).', lines: {
    header: L('SHIFT {SHIFT} · {NAME}', 'Top of the menu.', { w: 184 }, { SHIFT: 3, NAME: 'CENSUS' }),
    resume: L('RESUME', 'Back to the viewfinder.', { w: MENU_W }),
    order: L('WORK ORDER', 'Shows the work order again.', { w: MENU_W }),
    archive: L('ARCHIVE', 'The photos on file.', { w: 110 }),
    index: L('THE INDEX', 'The shared index (title screen and menu).', { w: MENU_W }),
    lab: L('LAB', 'The module bench (title screen and menu).', { w: MENU_W }),
    settings: L('SETTINGS', 'Title screen and menu.', { w: MENU_W }),
    end: L('END SHIFT', 'Ends the shift.', { w: 110 }),
    expose: L('OPEN THE BACK OF THE UNIT', 'Shifts 5 and 6: the open-back ending.', { w: 150 }),
    title: L('TITLE SCREEN', 'Back to the title.', { w: MENU_W }),
    endQuestion: L('END THE SHIFT AND RETURN FOR REVIEW?', 'Question after END SHIFT, quota met.', { w: 236, lines: 8 }),
    endEarly: L('QUOTA NOT MET ({FILED} OF {QUOTA}). THE OFFICE WILL ISSUE A CITATION. END THE SHIFT ANYWAY?', 'Question after END SHIFT, quota not met.', { w: 236, lines: 8 }, { FILED: 1, QUOTA: 3 }),
    endYes: L('END SHIFT', 'Its yes button.', { w: 100 }),
    endNo: L('KEEP WORKING', 'Its no button.', { w: 100 }),
    exposeQuestion: L('OPEN THE BACK OF THE UNIT? LIGHT WILL DESTROY ALL {N} EXPOSURES ON FILE. THE OFFICE WILL NOTICE.', 'Question after OPEN THE BACK OF THE UNIT.', { w: 236, lines: 8 }, { N: 41 }),
    exposeYes: L('OPEN IT', 'Its yes button (red).', { w: 100 }),
    exposeNo: L('CLOSE', 'Its no button.', { w: 100 }),
  } },
  { id: 'archive', name: 'Archive', lines: {
    title: L('ARCHIVE · {N} EXPOSURE{S} ON FILE', 'Top of the archive. {S} is an S except for 1.', { w: 304 }, { N: 12, S: 'S' }),
    empty: L('NO EXPOSURES ON FILE.', 'When there are none.', { w: 240, lines: 2 }),
    filed: L('FILED', 'Under each thumbnail that was filed.', { w: 40 }),
    hints: L('◂ ▸ ▴ ▾ CHOOSE · ● OPEN · SELECT BACK', 'Bottom of the contact sheet.', { w: 312 }),
    browse: L('◂ ▸ BROWSE · {I}/{N}', 'Top left of one photo.', { w: 200 }, { I: 4, N: 12 }),
    inIndex: L('IN THE INDEX {NO} · ▾ WITHDRAW', 'Top right of a photo that is in the shared index.', { w: 200 }, { NO: '0042' }),
  } },
  { id: 'report', name: 'Shift report', lines: {
    title: L('SHIFT REPORT · SHIFT {SHIFT} · {NAME}', 'Header.', { w: 267 }, { SHIFT: 3, NAME: 'CENSUS' }),
    filed: L('FILED {FILED} OF {N} · QUOTA {QUOTA}', 'First row under the requests.', { w: 220 }, { FILED: 4, N: 6, QUOTA: 4 }),
    met: L('MET', 'Its value, quota met.', { w: 80 }),
    notMet: L('NOT MET', 'Its value, quota not met.', { w: 80 }),
    used: L('EXPOSURES USED', 'Row.', { w: 220 }),
    withdrawn: L('JUDGEMENTS WITHDRAWN', 'Row (shift 5, after a NO).', { w: 220 }),
    meritFor: L('MERIT FOR REQUESTS', 'Row.', { w: 220 }),
    bonus: L('DILIGENCE BONUS (20%)', 'Row, quota met.', { w: 220 }),
    citation: L('CITATION', 'Row, quota not met.', { w: 220 }),
    onHand: L('MERIT ON HAND', 'Row.', { w: 220 }),
    approved: L('APPROVED', 'Stamp, quota met.', { w: 140, scale: 2 }),
    cited: L('CITATION', 'Stamp, quota not met.', { w: 140, scale: 2 }),
    citedWhy: L('QUOTA NOT MET', 'Second line of that stamp.', { w: 140 }),
    next: L('● REQUISITIONS', 'Bottom left, blinking.', { w: 200 }),
  } },
  { id: 'shop', name: 'Requisitions', lines: {
    title: L('REQUISITION FORM 12-B', 'Header.', { w: 275 }),
    merit: L('MERIT {MERIT}', 'Top right.', { w: 80 }, { MERIT: 245 }),
    max: L('MAX', 'Price column when a track is at its highest grade.', { w: 40 }),
    now: L('{SPEC} (NOW {CURRENT})', 'Second line of each item: the next grade and what the unit has.', { w: 152 }, { SPEC: '80×60', CURRENT: '64×48' }),
    off: L('OFF', 'What {CURRENT} says when the unit has none (TRACKING).', { w: 60 }),
    begin: L('BEGIN SHIFT {NEXT} ▸', 'Last row.', { w: 156 }, { NEXT: 4 }),
    done: L('RETURN TO TITLE', 'Last row after shift 7.', { w: 156 }),
    approved: L('APPROVED', 'Stamp on a bought item.', { w: 120 }),
    preview: L('PREVIEW: {WHAT}', 'Under the live preview.', { w: 124 }, { WHAT: 'SENSOR IV' }),
    current: L('CURRENT', 'What {WHAT} says when nothing is highlighted.', { w: 80 }),
    sensorNote: L('MORE PIXELS. SHARPER EVIDENCE PAYS MORE MERIT.', 'Note for SENSOR.', { w: 120, lines: 6 }),
    toneNote: L('MORE TONES, THEN COLOUR.', 'Note for TONE.', { w: 120, lines: 6 }),
    lensNote: L('DIGITAL ZOOM WITH ◂ ▸. SUBJECTS NEED NOT KNOW.', 'Note for LENS.', { w: 120, lines: 6 }),
    filmNote: L('MORE EXPOSURES PER SHIFT.', 'Note for FILM.', { w: 120, lines: 6 }),
    trackingNote: L('LIVE BOXES ON EVERY OBJECT THE INVENTORY KNOWS.', 'Note for TRACKING.', { w: 120, lines: 6 }),
    beginNote: L('UNSPENT MERIT CARRIES OVER.', 'Note on the last row.', { w: 120, lines: 6 }),
    poor: L('INSUFFICIENT MERIT', 'Notice: not enough merit.', { w: 240, lines: 2 }),
    maxed: L('ALREADY AT THE HIGHEST GRADE', 'Notice: nothing more to buy.', { w: 240, lines: 2 }),
  } },
  { id: 'settings', name: 'Settings', note: 'The DEV rows are not here: they are for testing.', lines: {
    title: L('UNIT SETTINGS', 'Header.', { w: 240 }),
    palette: L('PALETTE', 'Row.', { w: 150 }),
    body: L('BODY', 'Row.', { w: 150 }),
    silver: L('SILVER', 'BODY value.', { w: 90 }),
    graphite: L('GRAPHITE', 'BODY value.', { w: 90 }),
    sound: L('SOUND', 'Row.', { w: 150 }),
    vibration: L('VIBRATION', 'Row.', { w: 150 }),
    camera: L('CAMERA', 'Row.', { w: 150 }),
    front: L('FRONT', 'CAMERA value.', { w: 90 }),
    rear: L('BACK', 'CAMERA value.', { w: 90 }),
    tap: L('TAP SCREEN TO SHOOT', 'Row.', { w: 150 }),
    share: L('SHARE WITH THE INDEX', 'Row.', { w: 150 }),
    on: L('ON', 'Value.', { w: 60 }),
    off: L('OFF', 'Value.', { w: 60 }),
    erase: L('ERASE EVERYTHING', 'Row.', { w: 150 }),
    back: L('BACK', 'Row.', { w: 150 }),
    shareQuestion: L('SHARE YOUR SHIFT 5 FILINGS WITH THE INDEX? EACH ONE GOES AS A 40×30 TWO-TONE PRINT WITH ITS LABEL, AND ANYONE CAN SEE IT. SHARE ONLY PEOPLE WHO AGREED TO BE PHOTOGRAPHED.', 'Question before sharing is turned on.', { w: 236, lines: 10 }),
    shareYes: L('SHARE', 'Its yes button.', { w: 100 }),
    shareNo: L('NOT NOW', 'Its no button.', { w: 100 }),
    shareHint: L('SHARE ONLY PEOPLE WHO AGREED TO BE PHOTOGRAPHED.', 'Red line under the list on the SHARE row.', { w: 312 }),
    sharingOff: L('SHARING OFF', 'Notice when sharing is turned off.', { w: 240, lines: 2 }),
    eraseQuestion: L('ERASE EVERYTHING: SHIFTS, MERIT, SETTINGS AND EVERY EXPOSURE?', 'Question after ERASE EVERYTHING.', { w: 236, lines: 8 }),
    eraseYes: L('ERASE', 'Its yes button (red).', { w: 100 }),
    eraseNo: L('KEEP', 'Its no button.', { w: 100 }),
    hints: L('◂ ▸ CHANGE · ● OK · SELECT BACK', 'Bottom of the settings.', { w: 312 }),
  } },
  { id: 'index', name: 'The index', note: 'The INDEX screen on the camera. The labels themselves (SAD, ALONE…) are on the shift 5 page.', lines: {
    title: L('THE INDEX', 'Top left.', { w: 150 }),
    total: L('{N} PRINT{S} ON FILE', 'Top right. {S} is an S except for 1.', { w: 150 }, { N: 128, S: 'S' }),
    notConnected: L('THE INDEX IS NOT CONNECTED.', 'When the game has no index address.', { w: 240, lines: 3 }),
    contacting: L('CONTACTING THE INDEX…', 'While it loads.', { w: 240, lines: 3 }),
    noAnswer: L('THE INDEX DID NOT ANSWER.\n● TRY AGAIN', 'When it fails.', { w: 240, lines: 3 }),
    back: L('SELECT BACK', 'Bottom left when there is nothing to show.', { w: 150 }),
    filedN: L('{N} FILED', 'Under each label, and top right of its sheet.', { w: 90 }, { N: 12 }),
    none: L('NONE ON FILE', 'Under a label nobody has filed yet.', { w: 90 }),
    hints: L('▴▾ CHOOSE · ● OPEN · SELECT BACK', 'Bottom of the label list.', { w: 200 }),
    sharingOn: L('SHARING ON', 'Bottom right.', { w: 100 }),
    sharingOff: L('SHARING OFF', 'Bottom right.', { w: 100 }),
    heading: L('WHAT RECORDERS CALL {LABEL}', 'Heading of a label\'s sheet (also on the index web page).', { w: 236 }, { LABEL: 'SAD' }),
    headingNotBelong: L('WHO RECORDERS SAY {LABEL}', 'The same for DOES NOT BELONG.', { w: 236 }, { LABEL: 'DOES NOT BELONG' }),
    sheetHints: L('◂ ▸ ▴ ▾ CHOOSE · ● VIEW · SELECT BACK', 'Bottom of a label\'s sheet.', { w: 240 }),
    loading: L('LOADING…', 'Bottom right while more prints load.', { w: 70 }),
    filedAs: L('FILED AS', 'Stamp on one print, above its label.', { w: 120 }),
    printNo: L('INDEX {NO} · {DATE}', 'Top left of one print.', { w: 200 }, { NO: '0042', DATE: '21 NOV 2026' }),
    browse: L('◂ ▸ BROWSE · {I}/{N} · SELECT BACK', 'Bottom left of one print.', { w: 200 }, { I: 3, N: 12 }),
    yours: L('YOURS · ▾ WITHDRAW', 'Bottom right of a print this unit sent.', { w: 110 }),
    withdrawQuestion: L('WITHDRAW PRINT {NO} FROM THE INDEX? IT IS DELETED FOR EVERYONE.', 'Question before withdrawing (here and in the archive).', { w: 236, lines: 8 }, { NO: '0042' }),
    withdrawYes: L('WITHDRAW', 'Its yes button (red).', { w: 100 }),
    withdrawNo: L('KEEP', 'Its no button.', { w: 100 }),
    withdrawn: L('WITHDRAWN FROM THE INDEX', 'Notice after it\'s gone.', { w: 240, lines: 2 }),
    refused: L('THE INDEX REFUSED · TRY AGAIN', 'Notice when the index says no.', { w: 240, lines: 2 }),
    noAnswerToast: L('THE INDEX DID NOT ANSWER · TRY AGAIN', 'Notice when it can\'t be reached.', { w: 240, lines: 2 }),
  } },
  { id: 'ending', name: 'Endings', note: 'Two endings so far: filing THE RECORDER on shift 7, and opening the back of the unit (shifts 5-6).', lines: {
    sheet: L('FILE {RECORDER} · {N} EXPOSURES', 'Shift 7 ending, first screen: every photo on a contact sheet.', { w: 300 }, { N: 41 }, { shift: 7 }),
    filedTitle: L('NOTICE OF COMPLETION', 'Shift 7 ending: the document\'s title.', { w: 180 }, {}, { shift: 7 }),
    filedText: L('THE FILE ON RECORDER {RECORDER} IS COMPLETE.\n\nEXPOSURES ON FILE: {COUNT}\nEXPOSURES WITH SUBJECTS: {SUBJECTS}\nREQUESTS FILED: {FILED}\n\nEVERY EXPOSURE DESCRIBES THE ONE WHO TOOK IT: WHERE YOU WENT, WHAT YOU NOTICED, WHOM YOU CHOSE TO RECORD.\nTHE OFFICE THANKS YOU FOR YOUR SERVICE. YOUR CLEARANCE IS REVOKED.', 'Shift 7 ending: the document. Each new line starts a paragraph; an empty line leaves a gap.', { w: 272, lines: 13, doc: true }, { COUNT: 41, SUBJECTS: 23, FILED: 26 }, { shift: 7 }),
    filedStamp: L('FILED', 'Shift 7 ending: the stamp on it (RECORDER {RECORDER} under it).', { w: 150, scale: 3 }, {}, { shift: 7 }),
    revoked: L('CLEARANCE REVOKED', 'Shift 7 ending, last screen: over the picture, back at 40×30.', { w: 240, lines: 2 }, {}, { shift: 7 }),
    end: L('END · ● RETURN', 'Bottom of the last screen of both endings.', { w: 200 }),
    exposedTitle: L('INCIDENT REPORT', 'Open-back ending: the document\'s title.', { w: 180 }),
    exposedText: L('UNIT {UNIT}, ISSUED TO RECORDER {RECORDER}, WAS RETURNED WITH ITS BACK OPEN.\n\nEXPOSURES LOST TO LIGHT: {COUNT}\nRECORDS RECOVERED: 0\n\nRECORDER {RECORDER} COULD NOT BE REACHED FOR COMMENT.', 'Open-back ending: the document.', { w: 272, lines: 13, doc: true }, { COUNT: 41 }),
    exposedStamp: L('INCOMPLETE', 'Open-back ending: the stamp on it.', { w: 150, scale: 2 }),
    noFile: L('NO FILE', 'Open-back ending, last screen, under the name.', { w: 240 }),
  } },
  { id: 'nocam', name: 'No camera', lines: {
    title: L('UNIT FAULT: NO PICTURE', 'Header when the camera doesn\'t start.', { w: 243 }),
    failed: L('THE CAMERA DID NOT START.', 'First sentence when the browser gives no reason.', { w: 256, lines: 3 }),
    text: L('THE UNIT NEEDS THE CAMERA. ALLOW CAMERA ACCESS FOR THIS PAGE IN THE BROWSER, THEN TRY AGAIN. ON A PHONE THE PAGE MUST BE OPENED WITH AN HTTPS LINK.', 'What to do.', { w: 256, lines: 10 }),
    hints: L('● TRY AGAIN   SELECT: TITLE', 'Bottom.', { w: 264 }),
  } },
];

// Lines the unit cuts with … when they're too long, instead of running over (fitText).
const CUT = ['develop.noRequest', 'field.shoot', 'index.heading', 'index.headingNotBelong'];
const TAGS = ['verdict.subject', 'verdict.subjectN', 'verdict.distant', 'verdict.unaware'];

// key ('order.title') -> the line's text now (defaults until content.js applies edits).
export const TEXT = {};
// key -> { key, group, text (the default), where, fit, vars, shift }
export const LINES = {};
for (const g of GROUPS) {
  for (const [k, l] of Object.entries(g.lines)) {
    const key = `${g.id}.${k}`;
    TEXT[key] = l.text;
    const cut = CUT.includes(key) || (g.id === 'verdict' && !TAGS.includes(key)); // NOT FILED cuts at 250 px
    LINES[key] = { ...l, fit: cut ? { ...l.fit, cut: true } : l.fit, key, group: g.id };
  }
}

// Fill {NAME} placeholders. {RECORDER} and {UNIT} always work; an unknown name is left as it
// is (the controller warns about it).
export function fill(s, vars) {
  return String(s).replace(/\{([A-Z][A-Z0-9_]*)\}/g, (m, name) => {
    if (vars && vars[name] !== undefined) return String(vars[name]);
    if (name === 'RECORDER') return TEXT['global.recorder'];
    if (name === 'UNIT') return TEXT['global.unit'];
    return m;
  });
}

// The line for `key`, filled in.
export function t(key, vars) {
  const s = TEXT[key];
  return fill(s === undefined ? key : s, vars);
}

// The placeholders a line can use: its own, plus RECORDER and UNIT.
export function placeholders(key) {
  const l = LINES[key];
  return [...Object.keys((l && l.vars) || {}), 'RECORDER', 'UNIT'];
}
