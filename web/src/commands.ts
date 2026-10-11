import { tx, type Text } from './i18n';
import type { Loader } from './types';

/**
 * The command catalogue of the control tab: vanilla Java Edition console commands (1.13+ syntax),
 * grouped, each with a plain description. Placeholders in a command:
 *   %p%          the selected player (a name, or @a / @r)
 *   %key%        the value of the entry's argument `key`
 *   %key:json%   the same value as a JSON string (for text components)
 */

export interface Arg {
  key: string;
  label: Text;
  /** `coord` also takes ~ and ~5 (relative to where the command runs); `player` suggests known players. */
  kind?: 'text' | 'number' | 'coord' | 'select' | 'player';
  options?: [string, Text][];
  /** Suggestions for a free-text field; anything else (a modded id) can still be typed. */
  suggest?: string[];
  def?: string;
  placeholder?: string;
  /** May stay empty; always the last part of the command. */
  optional?: boolean;
}

export interface Action {
  label: Text;
  cmd: string;
  /** Asks before it runs. */
  danger?: boolean;
}

export interface Entry {
  id: string;
  title: Text;
  desc: Text;
  args?: Arg[];
  actions: Action[];
  /** The Minecraft versions the syntax works on (inclusive). */
  min?: string;
  max?: string;
  loaders?: Loader[];
}

export interface Group {
  id: string;
  title: Text;
  entries: Entry[];
}

const a = (en: string, hu: string, cmd: string, danger = false): Action => ({ label: tx(en, hu), cmd, ...(danger ? { danger: true } : {}) });

const NUMBER = /^-?\d+(\.\d+)?$/;
const COORD = /^(~|\^)?-?\d*(\.\d+)?$/;
const TARGET = /^([A-Za-z0-9_]{3,16}|@[apr])$/;

export const isTarget = (s: string) => TARGET.test(s.trim());

const valid = (arg: Arg, v: string) => {
  if (/[\r\n%]/.test(v)) return false;
  if (arg.kind === 'number') return NUMBER.test(v);
  if (arg.kind === 'coord') return COORD.test(v);
  if (arg.kind === 'player') return isTarget(v);
  if (arg.kind === 'select') return arg.options!.some(([o]) => o === v);
  return true;
};

const PLACEHOLDER = /%([a-z]+)(:json)?%/g;

export const needsPlayer = (action: Action) => action.cmd.includes('%p%');

/** The finished command, or null while the selected player or a required argument is missing or malformed. */
export function buildCommand(action: Action, entry: Entry, target: string, values: Record<string, string>) {
  let ok = true;
  const out = action.cmd.replace(PLACEHOLDER, (_, key: string, json?: string) => {
    if (key === 'p') {
      if (!isTarget(target)) ok = false;
      return target.trim();
    }
    const arg = entry.args?.find((x) => x.key === key);
    if (!arg) return '';
    const v = (values[`${entry.id}.${key}`] ?? arg.def ?? '').trim();
    if (!v) {
      if (!arg.optional) ok = false;
      return '';
    }
    if (!valid(arg, v)) ok = false;
    return json ? JSON.stringify(v) : v;
  });
  return ok ? out.trim() : null;
}

/** The command as it would be sent, with <name> standing in for whatever is still missing. */
export function previewCommand(action: Action, entry: Entry, target: string, values: Record<string, string>, playerWord: string, label: (t: Text) => string) {
  return action.cmd
    .replace(PLACEHOLDER, (_, key: string, json?: string) => {
      if (key === 'p') return isTarget(target) ? target.trim() : `<${playerWord}>`;
      const arg = entry.args?.find((x) => x.key === key);
      if (!arg) return '';
      const v = (values[`${entry.id}.${key}`] ?? arg.def ?? '').trim();
      if (!v) return arg.optional ? '' : `<${label(arg.label).toLowerCase()}>`;
      return json ? JSON.stringify(v) : v;
    })
    .trim();
}

// ---------- shared argument pieces ----------

const X: Arg = { key: 'x', label: tx('X', 'X'), kind: 'coord', placeholder: 'x' };
const Y: Arg = { key: 'y', label: tx('Y', 'Y'), kind: 'coord', placeholder: 'y' };
const Z: Arg = { key: 'z', label: tx('Z', 'Z'), kind: 'coord', placeholder: 'z' };
const REASON: Arg = { key: 'reason', label: tx('Reason', 'Indok'), optional: true, placeholder: '…' };
const TEXT: Arg = { key: 'text', label: tx('Text', 'Szöveg') };

const MODES: [string, Text][] = [
  ['survival', tx('Survival', 'Túlélő')],
  ['creative', tx('Creative', 'Kreatív')],
  ['adventure', tx('Adventure', 'Kaland')],
  ['spectator', tx('Spectator', 'Néző')],
];

const EFFECTS: [string, Text][] = [
  ['speed', tx('Speed', 'Gyorsaság')],
  ['haste', tx('Haste', 'Sietség')],
  ['strength', tx('Strength', 'Erő')],
  ['jump_boost', tx('Jump boost', 'Ugráserősítés')],
  ['regeneration', tx('Regeneration', 'Regeneráció')],
  ['resistance', tx('Resistance', 'Ellenállás')],
  ['fire_resistance', tx('Fire resistance', 'Tűzállóság')],
  ['water_breathing', tx('Water breathing', 'Vízlégzés')],
  ['night_vision', tx('Night vision', 'Éjjellátás')],
  ['invisibility', tx('Invisibility', 'Láthatatlanság')],
  ['slow_falling', tx('Slow falling', 'Lassú esés')],
  ['absorption', tx('Absorption', 'Elnyelés')],
  ['health_boost', tx('Health boost', 'Életerő-növelés')],
  ['saturation', tx('Saturation', 'Jóllakottság')],
  ['luck', tx('Luck', 'Szerencse')],
  ['glowing', tx('Glowing', 'Ragyogás')],
  ['levitation', tx('Levitation', 'Lebegés')],
  ['conduit_power', tx('Conduit power', 'Áramlat ereje')],
  ['dolphins_grace', tx('Dolphin’s grace', 'Delfin kegyelme')],
  ['slowness', tx('Slowness', 'Lassúság')],
  ['mining_fatigue', tx('Mining fatigue', 'Bányászfáradtság')],
  ['weakness', tx('Weakness', 'Gyengeség')],
  ['blindness', tx('Blindness', 'Vakság')],
  ['nausea', tx('Nausea', 'Émelygés')],
  ['hunger', tx('Hunger', 'Éhség')],
  ['poison', tx('Poison', 'Méreg')],
  ['wither', tx('Wither', 'Sorvadás')],
];

const ENCHANTS: [string, Text][] = [
  ['mending', tx('Mending', 'Javítás')],
  ['unbreaking', tx('Unbreaking', 'Törhetetlenség')],
  ['efficiency', tx('Efficiency', 'Hatékonyság')],
  ['fortune', tx('Fortune', 'Szerencse')],
  ['silk_touch', tx('Silk touch', 'Selyemérintés')],
  ['sharpness', tx('Sharpness', 'Élesség')],
  ['looting', tx('Looting', 'Zsákmányolás')],
  ['fire_aspect', tx('Fire aspect', 'Lángpallos')],
  ['knockback', tx('Knockback', 'Hátralökés')],
  ['power', tx('Power', 'Erő (íj)')],
  ['infinity', tx('Infinity', 'Végtelenség')],
  ['flame', tx('Flame', 'Láng')],
  ['punch', tx('Punch', 'Ütés')],
  ['protection', tx('Protection', 'Védelem')],
  ['feather_falling', tx('Feather falling', 'Könnyű esés')],
  ['thorns', tx('Thorns', 'Tüskék')],
  ['respiration', tx('Respiration', 'Légzés')],
  ['aqua_affinity', tx('Aqua affinity', 'Vízi affinitás')],
  ['depth_strider', tx('Depth strider', 'Mélységjáró')],
  ['frost_walker', tx('Frost walker', 'Fagyjáró')],
  ['soul_speed', tx('Soul speed', 'Léleksebesség')],
  ['loyalty', tx('Loyalty', 'Hűség')],
  ['riptide', tx('Riptide', 'Sodrás')],
  ['channeling', tx('Channeling', 'Villámcsatorna')],
  ['luck_of_the_sea', tx('Luck of the sea', 'Tenger szerencséje')],
  ['lure', tx('Lure', 'Csali')],
];

const ITEMS = [
  'minecraft:diamond', 'minecraft:netherite_ingot', 'minecraft:iron_ingot', 'minecraft:gold_ingot', 'minecraft:emerald', 'minecraft:coal', 'minecraft:redstone',
  'minecraft:cooked_beef', 'minecraft:bread', 'minecraft:golden_apple', 'minecraft:enchanted_golden_apple', 'minecraft:golden_carrot',
  'minecraft:diamond_sword', 'minecraft:diamond_pickaxe', 'minecraft:diamond_axe', 'minecraft:diamond_shovel', 'minecraft:bow', 'minecraft:arrow', 'minecraft:shield',
  'minecraft:diamond_helmet', 'minecraft:diamond_chestplate', 'minecraft:diamond_leggings', 'minecraft:diamond_boots', 'minecraft:elytra', 'minecraft:firework_rocket',
  'minecraft:totem_of_undying', 'minecraft:ender_pearl', 'minecraft:experience_bottle', 'minecraft:torch', 'minecraft:water_bucket', 'minecraft:lava_bucket',
  'minecraft:oak_log', 'minecraft:cobblestone', 'minecraft:obsidian', 'minecraft:tnt', 'minecraft:red_bed', 'minecraft:crafting_table', 'minecraft:furnace',
  'minecraft:chest', 'minecraft:ender_chest', 'minecraft:shulker_box', 'minecraft:name_tag', 'minecraft:saddle', 'minecraft:lead', 'minecraft:oak_boat',
];

const MOBS = [
  'minecraft:pig', 'minecraft:cow', 'minecraft:sheep', 'minecraft:chicken', 'minecraft:horse', 'minecraft:wolf', 'minecraft:cat', 'minecraft:villager',
  'minecraft:iron_golem', 'minecraft:zombie', 'minecraft:skeleton', 'minecraft:creeper', 'minecraft:spider', 'minecraft:enderman', 'minecraft:witch',
  'minecraft:slime', 'minecraft:phantom', 'minecraft:pillager', 'minecraft:blaze', 'minecraft:bat', 'minecraft:armor_stand',
];

const STRUCTURES = [
  '#minecraft:village', 'minecraft:stronghold', 'minecraft:mansion', 'minecraft:monument', 'minecraft:ancient_city', 'minecraft:fortress', 'minecraft:bastion_remnant',
  'minecraft:end_city', 'minecraft:pillager_outpost', 'minecraft:desert_pyramid', 'minecraft:jungle_pyramid', 'minecraft:igloo', 'minecraft:swamp_hut',
  '#minecraft:shipwreck', 'minecraft:buried_treasure', '#minecraft:ruined_portal', '#minecraft:mineshaft', '#minecraft:ocean_ruin', 'minecraft:trail_ruins',
  'minecraft:trial_chambers',
];

const BIOMES = [
  'minecraft:plains', 'minecraft:forest', 'minecraft:dark_forest', 'minecraft:cherry_grove', 'minecraft:jungle', 'minecraft:desert', 'minecraft:badlands',
  'minecraft:savanna', 'minecraft:swamp', 'minecraft:mangrove_swamp', 'minecraft:taiga', 'minecraft:snowy_plains', 'minecraft:ice_spikes', 'minecraft:meadow',
  'minecraft:jagged_peaks', 'minecraft:mushroom_fields', 'minecraft:deep_dark', 'minecraft:lush_caves', 'minecraft:dripstone_caves', 'minecraft:warm_ocean',
  'minecraft:nether_wastes', 'minecraft:crimson_forest', 'minecraft:warped_forest', 'minecraft:soul_sand_valley', 'minecraft:basalt_deltas', 'minecraft:end_highlands',
];

const SOUNDS = [
  'minecraft:entity.player.levelup', 'minecraft:entity.experience_orb.pickup', 'minecraft:block.note_block.pling', 'minecraft:block.bell.use',
  'minecraft:ui.toast.challenge_complete', 'minecraft:entity.ender_dragon.growl', 'minecraft:entity.wither.spawn', 'minecraft:entity.creeper.primed',
  'minecraft:entity.lightning_bolt.thunder', 'minecraft:entity.villager.celebrate', 'minecraft:block.anvil.land',
];

const COLORS: [string, Text][] = [
  ['gold', tx('Gold', 'Arany')],
  ['yellow', tx('Yellow', 'Sárga')],
  ['green', tx('Green', 'Zöld')],
  ['aqua', tx('Aqua', 'Türkiz')],
  ['blue', tx('Blue', 'Kék')],
  ['light_purple', tx('Pink', 'Rózsaszín')],
  ['red', tx('Red', 'Piros')],
  ['white', tx('White', 'Fehér')],
  ['gray', tx('Gray', 'Szürke')],
];

// Game rules were renamed in 1.21.11 (keepInventory became keep_inventory, and so on), so each rule
// is listed under both names and the server's version picks one.
const RULES_OLD_MAX = '1.21.10';
const RULES_NEW_MIN = '1.21.11';

type Range = Pick<Entry, 'min' | 'max'>;
const ranges = (old: string | null, neu: string | null, min?: string): [string, Range][] => [
  ...(old ? [[old, { ...(min ? { min } : {}), max: RULES_OLD_MAX }] as [string, Range]] : []),
  ...(neu ? [[neu, { min: RULES_NEW_MIN }] as [string, Range]] : []),
];

/** A yes/no rule under its old and its new name (null where it does not exist); `min` is when the old one arrived. */
const rule = (old: string | null, neu: string | null, title: Text, desc: Text, min?: string): Entry[] =>
  ranges(old, neu, min).map(([name, range]) => ({
    id: `rule-${name}`,
    title,
    desc,
    ...range,
    actions: [a('On', 'Be', `gamerule ${name} true`), a('Off', 'Ki', `gamerule ${name} false`), a('Check', 'Lekérdezés', `gamerule ${name}`)],
  }));

const numberRule = (old: string | null, neu: string | null, def: string, title: Text, desc: Text, min?: string): Entry[] =>
  ranges(old, neu, min).map(([name, range]) => ({
    id: `rule-${name}`,
    title,
    desc,
    ...range,
    args: [{ key: 'value', label: tx('Value', 'Érték'), kind: 'number', def }],
    actions: [a('Set', 'Beállítás', `gamerule ${name} %value%`), a('Check', 'Lekérdezés', `gamerule ${name}`)],
  }));

// ---------- the catalogue ----------

export const GROUPS: Group[] = [
  {
    id: 'player',
    title: tx('Selected player', 'Kiválasztott játékos'),
    entries: [
      {
        id: 'op',
        title: tx('Operator rights', 'Operátori jog'),
        desc: tx('An operator can use every command inside the game (cheats, world settings). Some modpacks need one to set up the world.', 'Az operátor a játékon belül minden parancsot használhat (csalások, világbeállítások). Néhány modpack operátort vár a világ beállításához.'),
        actions: [a('Give OP', 'OP adása', 'op %p%'), a('Take OP', 'OP elvétele', 'deop %p%')],
      },
      {
        id: 'gamemode',
        title: tx('Game mode', 'Játékmód'),
        desc: tx('Survival: normal play. Creative: unlimited blocks and flying. Adventure: cannot break blocks. Spectator: flies through walls, unseen.', 'Túlélő: normál játék. Kreatív: végtelen blokk és repülés. Kaland: nem tud blokkot törni. Néző: átrepül a falakon, láthatatlan.'),
        actions: MODES.map(([mode, label]) => ({ label, cmd: `gamemode ${mode} %p%` })),
      },
      {
        id: 'vitals',
        title: tx('Health and hunger', 'Életerő és éhség'),
        desc: tx('Fills the hearts or the hunger bar at once.', 'Azonnal feltölti a szíveket, illetve az éhségcsíkot.'),
        actions: [a('Heal', 'Gyógyítás', 'effect give %p% minecraft:instant_health 1 10'), a('Feed', 'Etetés', 'effect give %p% minecraft:saturation 1 10')],
      },
      {
        id: 'effect',
        title: tx('Give an effect', 'Effekt adása'),
        desc: tx('A potion effect for the given seconds. Level 0 is level I, 1 is level II, and so on.', 'Bájital-effekt a megadott másodpercre. A 0-s szint az I-es, az 1-es a II-es, és így tovább.'),
        args: [
          { key: 'effect', label: tx('Effect', 'Effekt'), kind: 'select', options: EFFECTS, def: 'speed' },
          { key: 'seconds', label: tx('Seconds', 'Másodperc'), kind: 'number', def: '120' },
          { key: 'level', label: tx('Level', 'Szint'), kind: 'number', def: '0' },
        ],
        actions: [a('Give', 'Adás', 'effect give %p% minecraft:%effect% %seconds% %level%'), a('Remove this one', 'Ennek levétele', 'effect clear %p% minecraft:%effect%')],
      },
      {
        id: 'effect-clear',
        title: tx('Clear every effect', 'Minden effekt törlése'),
        desc: tx('Removes all potion effects, good and bad.', 'Leveszi az összes bájital-effektet, a jókat és a rosszakat is.'),
        actions: [a('Clear effects', 'Effektek törlése', 'effect clear %p%')],
      },
      {
        id: 'give',
        title: tx('Give an item', 'Tárgy adása'),
        desc: tx('Puts items into the inventory. Modded items work with their id too (modid:item).', 'Tárgyat tesz az inventoryba. Modos tárgy is megy az azonosítójával (modid:item).'),
        args: [
          { key: 'item', label: tx('Item', 'Tárgy'), suggest: ITEMS, def: 'minecraft:diamond' },
          { key: 'count', label: tx('Count', 'Darab'), kind: 'number', def: '1' },
        ],
        actions: [a('Give', 'Adás', 'give %p% %item% %count%')],
      },
      {
        id: 'clear',
        title: tx('Empty the inventory', 'Inventory ürítése'),
        desc: tx('Deletes everything the player carries, or only one kind of item.', 'Töröl mindent, ami a játékosnál van, vagy csak egyféle tárgyat.'),
        args: [{ key: 'item', label: tx('Item', 'Tárgy'), suggest: ITEMS, def: 'minecraft:tnt' }],
        actions: [a('Everything', 'Mindent', 'clear %p%', true), a('Only this item', 'Csak ezt a tárgyat', 'clear %p% %item%', true)],
      },
      {
        id: 'xp',
        title: tx('Experience', 'Tapasztalat (XP)'),
        desc: tx('Adds or sets experience levels, or prints the current level in the console.', 'XP-szintet ad vagy állít be, illetve kiírja a jelenlegi szintet a konzolba.'),
        args: [{ key: 'n', label: tx('Amount', 'Mennyiség'), kind: 'number', def: '10' }],
        actions: [
          a('Add levels', 'Szint adása', 'xp add %p% %n% levels'),
          a('Add points', 'Pont adása', 'xp add %p% %n% points'),
          a('Set level', 'Szint beállítása', 'xp set %p% %n% levels'),
          a('Check', 'Lekérdezés', 'xp query %p% levels'),
        ],
      },
      {
        id: 'tp-xyz',
        title: tx('Teleport to coordinates', 'Teleport koordinátára'),
        desc: tx('Moves the player to the given block in the dimension they are in.', 'A megadott blokkra viszi a játékost, abban a dimenzióban, ahol éppen van.'),
        args: [X, Y, Z],
        actions: [a('Teleport', 'Teleport', 'tp %p% %x% %y% %z%')],
      },
      {
        id: 'tp-player',
        title: tx('Teleport to another player', 'Teleport másik játékoshoz'),
        desc: tx('Sends the selected player to the other one, brings the other one here, or gathers everyone at the selected player.', 'A kiválasztott játékost a másikhoz küldi, a másikat ide hozza, vagy mindenkit a kiválasztott játékoshoz gyűjt.'),
        args: [{ key: 'to', label: tx('Other player', 'Másik játékos'), kind: 'player' }],
        actions: [a('Send to them', 'Küldés hozzá', 'tp %p% %to%'), a('Bring them here', 'Idehozás', 'tp %to% %p%'), a('Everyone here', 'Mindenki ide', 'tp @a %p%')],
      },
      {
        id: 'where',
        title: tx('Where are they?', 'Hol van?'),
        desc: tx('Prints the player’s coordinates, dimension or health in the console.', 'Kiírja a konzolba a játékos koordinátáit, dimenzióját vagy életerejét.'),
        actions: [a('Position', 'Pozíció', 'data get entity %p% Pos'), a('Dimension', 'Dimenzió', 'data get entity %p% Dimension'), a('Health', 'Életerő', 'data get entity %p% Health')],
      },
      {
        id: 'spawnpoint',
        title: tx('Respawn point', 'Újraéledési pont'),
        desc: tx('Sets the player’s respawn point to where they stand right now.', 'Az újraéledési pontot oda állítja, ahol a játékos éppen áll.'),
        actions: [a('Set it here', 'Beállítás ide', 'execute as %p% at @s run spawnpoint @s ~ ~ ~')],
      },
      {
        id: 'tell',
        title: tx('Private message', 'Privát üzenet'),
        desc: tx('Only this player sees it in chat, as a whisper from the server.', 'Csak ez a játékos látja a chatben, a szerver suttogásaként.'),
        args: [TEXT],
        actions: [a('Send', 'Küldés', 'tell %p% %text%')],
      },
      {
        id: 'title',
        title: tx('Text on their screen', 'Felirat a képernyőjére'),
        desc: tx('A big title in the middle of the screen, or a small line above the hotbar.', 'Nagy felirat a képernyő közepén, vagy kis sor a gyorssáv fölött.'),
        args: [TEXT],
        actions: [a('Big title', 'Nagy felirat', 'title %p% title {"text":%text:json%}'), a('Above the hotbar', 'Gyorssáv fölé', 'title %p% actionbar {"text":%text:json%}')],
      },
      {
        id: 'enchant',
        title: tx('Enchant the held item', 'Kézben tartott tárgy varázsolása'),
        desc: tx('Works when the item in the player’s hand can take this enchantment at this level.', 'Akkor működik, ha a játékos kezében lévő tárgy fogadja ezt a varázslatot ezen a szinten.'),
        args: [
          { key: 'ench', label: tx('Enchantment', 'Varázslat'), kind: 'select', options: ENCHANTS, def: 'mending' },
          { key: 'level', label: tx('Level', 'Szint'), kind: 'number', def: '1' },
        ],
        actions: [a('Enchant', 'Varázsolás', 'enchant %p% minecraft:%ench% %level%')],
      },
      {
        id: 'advancements',
        title: tx('Advancements', 'Achievementek'),
        desc: tx('Grants every advancement, or takes them all away.', 'Megadja az összes achievementet, vagy mindet elveszi.'),
        actions: [a('Grant all', 'Mind megadása', 'advancement grant %p% everything'), a('Revoke all', 'Mind elvétele', 'advancement revoke %p% everything', true)],
      },
      {
        id: 'recipes',
        title: tx('Recipe book', 'Receptkönyv'),
        desc: tx('Unlocks every recipe in the recipe book, or locks them again.', 'Feloldja a receptkönyv összes receptjét, vagy újra lezárja őket.'),
        actions: [a('Unlock all', 'Mind feloldása', 'recipe give %p% *'), a('Lock all', 'Mind lezárása', 'recipe take %p% *', true)],
      },
      {
        id: 'max-health-old',
        title: tx('Maximum health', 'Maximális életerő'),
        desc: tx('20 is the normal ten hearts, 40 is twenty hearts.', 'A 20 a szokásos tíz szív, a 40 húsz szív.'),
        max: '1.21.1',
        args: [{ key: 'value', label: tx('Health', 'Életerő'), kind: 'number', def: '20' }],
        actions: [a('Set', 'Beállítás', 'attribute %p% minecraft:generic.max_health base set %value%')],
      },
      {
        id: 'max-health',
        title: tx('Maximum health', 'Maximális életerő'),
        desc: tx('20 is the normal ten hearts, 40 is twenty hearts.', 'A 20 a szokásos tíz szív, a 40 húsz szív.'),
        min: '1.21.2',
        args: [{ key: 'value', label: tx('Health', 'Életerő'), kind: 'number', def: '20' }],
        actions: [a('Set', 'Beállítás', 'attribute %p% minecraft:max_health base set %value%')],
      },
      {
        id: 'scale-old',
        title: tx('Player size', 'Játékos mérete'),
        desc: tx('1 is normal; 0.5 is half size, 2 is double.', 'Az 1 a normál; a 0.5 fele akkora, a 2 kétszeres.'),
        min: '1.20.5',
        max: '1.21.1',
        args: [{ key: 'value', label: tx('Scale', 'Méret'), kind: 'number', def: '1' }],
        actions: [a('Set', 'Beállítás', 'attribute %p% minecraft:generic.scale base set %value%')],
      },
      {
        id: 'scale',
        title: tx('Player size', 'Játékos mérete'),
        desc: tx('1 is normal; 0.5 is half size, 2 is double.', 'Az 1 a normál; a 0.5 fele akkora, a 2 kétszeres.'),
        min: '1.21.2',
        args: [{ key: 'value', label: tx('Scale', 'Méret'), kind: 'number', def: '1' }],
        actions: [a('Set', 'Beállítás', 'attribute %p% minecraft:scale base set %value%')],
      },
      {
        id: 'damage',
        title: tx('Deal damage', 'Sebzés'),
        desc: tx('Takes the given health points (2 points are one heart).', 'Levonja a megadott életerőpontot (2 pont egy szív).'),
        min: '1.19.4',
        args: [{ key: 'n', label: tx('Points', 'Pont'), kind: 'number', def: '2' }],
        actions: [a('Damage', 'Sebzés', 'damage %p% %n%', true)],
      },
      {
        id: 'kill',
        title: tx('Kill', 'Megölés'),
        desc: tx('The player dies and drops their items (unless keepInventory is on).', 'A játékos meghal, és elejti a tárgyait (kivéve, ha a keepInventory be van kapcsolva).'),
        actions: [a('Kill', 'Megölés', 'kill %p%', true)],
      },
      {
        id: 'summon',
        title: tx('Summon a mob next to them', 'Mob idézése mellé'),
        desc: tx('Spawns the creature where the player stands. A modded entity id works too.', 'Oda idézi a lényt, ahol a játékos áll. Modos entitás azonosítója is megy.'),
        args: [{ key: 'mob', label: tx('Mob', 'Mob'), suggest: MOBS, def: 'minecraft:pig' }],
        actions: [a('Summon', 'Idézés', 'execute at %p% run summon %mob% ~ ~ ~')],
      },
      {
        id: 'fun',
        title: tx('Pranks', 'Tréfák'),
        desc: tx('A lightning bolt on the player, a few seconds of flying upwards, or a glowing outline seen through walls.', 'Villámcsapás a játékosra, pár másodperc felfelé repülés, vagy falon át is látszó ragyogó körvonal.'),
        actions: [
          a('Lightning', 'Villám', 'execute at %p% run summon minecraft:lightning_bolt ~ ~ ~', true),
          a('Launch', 'Kilövés', 'effect give %p% minecraft:levitation 3 20'),
          a('Glow', 'Ragyogás', 'effect give %p% minecraft:glowing 60 0'),
        ],
      },
      {
        id: 'playsound',
        title: tx('Play a sound', 'Hang lejátszása'),
        desc: tx('Only the selected player hears it.', 'Csak a kiválasztott játékos hallja.'),
        args: [{ key: 'sound', label: tx('Sound', 'Hang'), suggest: SOUNDS, def: 'minecraft:entity.player.levelup' }],
        actions: [a('Play', 'Lejátszás', 'execute as %p% at @s run playsound %sound% master @s')],
      },
      {
        id: 'scatter',
        title: tx('Scatter randomly', 'Véletlen szétszórás'),
        desc: tx('Teleports the player (or with @a everyone) to a random spot around the given centre, at most this many blocks away.', 'A játékost (vagy @a esetén mindenkit) véletlen helyre teleportálja a megadott középpont körül, legfeljebb ennyi blokkra.'),
        args: [
          { ...X, def: '0' },
          { ...Z, def: '0' },
          { key: 'range', label: tx('Max distance', 'Max. távolság'), kind: 'number', def: '1000' },
        ],
        actions: [a('Scatter', 'Szétszórás', 'spreadplayers %x% %z% 50 %range% false %p%', true)],
      },
      {
        id: 'scores-reset',
        title: tx('Reset their scores', 'Pontszámok nullázása'),
        desc: tx('Clears the player’s values on every scoreboard (deaths, kills…).', 'Törli a játékos értékeit minden scoreboardon (halálok, ölések…).'),
        actions: [a('Reset scores', 'Nullázás', 'scoreboard players reset %p%', true)],
      },
    ],
  },
  {
    id: 'access',
    title: tx('Access and moderation', 'Hozzáférés és moderálás'),
    entries: [
      {
        id: 'wl-player',
        title: tx('Whitelist: selected player', 'Whitelist: kiválasztott játékos'),
        desc: tx('Adds the player to the list of people allowed to join, or removes them.', 'Felveszi a játékost a belépésre jogosultak listájára, vagy leveszi róla.'),
        actions: [a('Add', 'Felvétel', 'whitelist add %p%'), a('Remove', 'Levétel', 'whitelist remove %p%')],
      },
      {
        id: 'wl-switch',
        title: tx('Whitelist', 'Whitelist'),
        desc: tx('Switched on, only listed players can join. Reload re-reads whitelist.json after a manual edit.', 'Bekapcsolva csak a listán szereplők léphetnek be. Az újratöltés kézi szerkesztés után újraolvassa a whitelist.json-t.'),
        actions: [a('On', 'Be', 'whitelist on'), a('Off', 'Ki', 'whitelist off'), a('List', 'Lista', 'whitelist list'), a('Reload', 'Újratöltés', 'whitelist reload')],
      },
      {
        id: 'kick',
        title: tx('Kick', 'Kirúgás'),
        desc: tx('Disconnects the player; they can come right back.', 'Lecsatlakoztatja a játékost; azonnal vissza tud jönni.'),
        args: [REASON],
        actions: [a('Kick', 'Kirúgás', 'kick %p% %reason%')],
      },
      {
        id: 'ban',
        title: tx('Ban', 'Kitiltás'),
        desc: tx('The player can no longer join until the ban is lifted.', 'A játékos nem tud belépni, amíg a kitiltást fel nem oldod.'),
        args: [REASON],
        actions: [a('Ban', 'Kitiltás', 'ban %p% %reason%', true), a('Lift the ban', 'Feloldás', 'pardon %p%')],
      },
      {
        id: 'ban-ip',
        title: tx('Ban an IP address', 'IP-cím kitiltása'),
        desc: tx('Nobody can join from that address. You can also ban the address the selected online player uses.', 'Arról a címről senki nem léphet be. A kiválasztott, online játékos címét is kitilthatod.'),
        args: [{ key: 'ip', label: tx('IP address', 'IP-cím'), placeholder: '203.0.113.7' }],
        actions: [a('Ban the address', 'Cím kitiltása', 'ban-ip %ip%', true), a('Ban the player’s address', 'A játékos címének kitiltása', 'ban-ip %p%', true), a('Lift', 'Feloldás', 'pardon-ip %ip%')],
      },
      {
        id: 'banlist',
        title: tx('Ban lists', 'Kitiltási listák'),
        desc: tx('Prints the banned players or addresses in the console.', 'Kiírja a konzolba a kitiltott játékosokat vagy címeket.'),
        actions: [a('Players', 'Játékosok', 'banlist players'), a('Addresses', 'Címek', 'banlist ips')],
      },
      {
        id: 'kick-all',
        title: tx('Kick everyone', 'Mindenki kirúgása'),
        desc: tx('Disconnects every player, for example before maintenance.', 'Minden játékost lecsatlakoztat, például karbantartás előtt.'),
        args: [REASON],
        actions: [a('Kick everyone', 'Mindenki ki', 'kick @a %reason%', true)],
      },
      {
        id: 'idle',
        title: tx('Idle timeout', 'Tétlenségi időkorlát'),
        desc: tx('Players who do nothing for this many minutes are kicked. 0 switches it off.', 'Aki ennyi percig semmit nem csinál, azt a szerver kirúgja. A 0 kikapcsolja.'),
        args: [{ key: 'minutes', label: tx('Minutes', 'Perc'), kind: 'number', def: '0' }],
        actions: [a('Set', 'Beállítás', 'setidletimeout %minutes%')],
      },
      {
        id: 'list',
        title: tx('Who is online?', 'Ki van fent?'),
        desc: tx('Prints the players who are online, with their UUIDs if you want.', 'Kiírja a fent lévő játékosokat, kérésre UUID-val együtt.'),
        actions: [a('Who is online?', 'Ki van fent?', 'list'), a('With UUIDs', 'UUID-kkal', 'list uuids')],
      },
    ],
  },
  {
    id: 'chat',
    title: tx('Messages', 'Üzenetek'),
    entries: [
      {
        id: 'say',
        title: tx('Message to everyone', 'Üzenet mindenkinek'),
        desc: tx('Shows in chat as [Server].', 'A chatben [Server] néven jelenik meg.'),
        args: [TEXT],
        actions: [a('Send', 'Küldés', 'say %text%')],
      },
      {
        id: 'announce',
        title: tx('Coloured announcement', 'Színes bejelentés'),
        desc: tx('A bold coloured line in everyone’s chat, without a sender name.', 'Félkövér, színes sor mindenki chatjében, feladó neve nélkül.'),
        args: [TEXT, { key: 'color', label: tx('Colour', 'Szín'), kind: 'select', options: COLORS, def: 'gold' }],
        actions: [a('Announce', 'Bejelentés', 'tellraw @a {"text":%text:json%,"color":"%color%","bold":true}')],
      },
      {
        id: 'title-all',
        title: tx('Text on everyone’s screen', 'Felirat mindenki képernyőjére'),
        desc: tx('A big title, a subtitle (it shows together with the next title) or a line above the hotbar.', 'Nagy felirat, alcím (a következő felirattal együtt jelenik meg) vagy sor a gyorssáv fölött.'),
        args: [TEXT],
        actions: [
          a('Big title', 'Nagy felirat', 'title @a title {"text":%text:json%}'),
          a('Subtitle', 'Alcím', 'title @a subtitle {"text":%text:json%}'),
          a('Above the hotbar', 'Gyorssáv fölé', 'title @a actionbar {"text":%text:json%}'),
          a('Clear', 'Törlés', 'title @a clear'),
        ],
      },
      {
        id: 'link',
        title: tx('Clickable link in chat', 'Kattintható link a chatben'),
        desc: tx('Everyone gets an underlined line that opens the address, for example a Discord invite.', 'Mindenki kap egy aláhúzott sort, ami megnyitja a címet, például egy Discord-meghívót.'),
        max: '1.21.4',
        args: [TEXT, { key: 'url', label: tx('Address', 'Cím'), placeholder: 'https://…' }],
        actions: [a('Send', 'Küldés', 'tellraw @a {"text":%text:json%,"color":"aqua","underlined":true,"clickEvent":{"action":"open_url","value":%url:json%}}')],
      },
      {
        id: 'me',
        title: tx('Action line', 'Cselekvés-sor'),
        desc: tx('Shows as “* Server <text>”, like a narrator.', '„* Server <szöveg>” formában jelenik meg, mint egy narrátor.'),
        args: [TEXT],
        actions: [a('Send', 'Küldés', 'me %text%')],
      },
    ],
  },
  {
    id: 'time',
    title: tx('Time and weather', 'Idő és időjárás'),
    entries: [
      {
        id: 'time',
        title: tx('Time of day', 'Napszak'),
        desc: tx('Jumps the world’s clock to that part of the day.', 'A világ óráját arra a napszakra ugratja.'),
        actions: [
          a('Sunrise', 'Napkelte', 'time set 23000'),
          a('Day', 'Nappal', 'time set day'),
          a('Noon', 'Dél', 'time set noon'),
          a('Sunset', 'Napnyugta', 'time set 12000'),
          a('Night', 'Éjszaka', 'time set night'),
          a('Midnight', 'Éjfél', 'time set midnight'),
        ],
      },
      {
        id: 'time-add',
        title: tx('Skip time', 'Idő előretekerése'),
        desc: tx('Moves the clock forward by game ticks: 1000 is one in-game hour, 24000 a whole day.', 'Játéktickekkel előrébb viszi az órát: 1000 egy játékbeli óra, 24000 egy teljes nap.'),
        args: [{ key: 'n', label: tx('Ticks', 'Tick'), kind: 'number', def: '24000' }],
        actions: [a('Skip', 'Tekerés', 'time add %n%')],
      },
      {
        id: 'time-query',
        title: tx('What time is it?', 'Mennyi az idő?'),
        desc: tx('Prints the time of day in ticks, the number of days passed, or the world’s total age.', 'Kiírja a napszakot tickben, az eltelt napok számát, vagy a világ teljes korát.'),
        max: '1.21.11',
        actions: [a('Time of day', 'Napszak', 'time query daytime'), a('Day count', 'Napok száma', 'time query day'), a('World age', 'Világ kora', 'time query gametime')],
      },
      {
        id: 'time-query-new',
        title: tx('What time is it?', 'Mennyi az idő?'),
        desc: tx('Prints the time of day in ticks, the world clock (it keeps counting across days), or the world’s total age.', 'Kiírja a napszakot tickben, a világ óráját (a napokon át tovább számol), vagy a világ teljes korát.'),
        min: '26.1',
        actions: [a('Time of day', 'Napszak', 'time query day'), a('World clock', 'Világ órája', 'time query time'), a('World age', 'Világ kora', 'time query gametime')],
      },
      {
        id: 'daylight',
        title: tx('Day–night cycle', 'Nappal–éjszaka váltakozás'),
        desc: tx('Switched off, the time of day stands still (always day, if you set day first).', 'Kikapcsolva megáll a napszak (örök nappal, ha előbb nappalt állítasz).'),
        max: RULES_OLD_MAX,
        actions: [a('Runs', 'Jár', 'gamerule doDaylightCycle true'), a('Frozen', 'Megállítva', 'gamerule doDaylightCycle false')],
      },
      {
        id: 'daylight-new',
        title: tx('Day–night cycle', 'Nappal–éjszaka váltakozás'),
        desc: tx('Switched off, the time of day stands still (always day, if you set day first).', 'Kikapcsolva megáll a napszak (örök nappal, ha előbb nappalt állítasz).'),
        min: RULES_NEW_MIN,
        actions: [a('Runs', 'Jár', 'gamerule advance_time true'), a('Frozen', 'Megállítva', 'gamerule advance_time false')],
      },
      {
        id: 'weather',
        title: tx('Weather', 'Időjárás'),
        desc: tx('Changes the weather right away; it keeps changing by itself afterwards.', 'Azonnal átállítja az időjárást; utána magától változik tovább.'),
        actions: [a('Clear', 'Derült', 'weather clear'), a('Rain', 'Eső', 'weather rain'), a('Thunder', 'Vihar', 'weather thunder')],
      },
      {
        id: 'weather-cycle',
        title: tx('Weather changes', 'Időjárás-változás'),
        desc: tx('Switched off, the weather stays as it is now.', 'Kikapcsolva az időjárás úgy marad, ahogy most van.'),
        max: RULES_OLD_MAX,
        actions: [a('Changes', 'Változik', 'gamerule doWeatherCycle true'), a('Frozen', 'Megállítva', 'gamerule doWeatherCycle false')],
      },
      {
        id: 'weather-cycle-new',
        title: tx('Weather changes', 'Időjárás-változás'),
        desc: tx('Switched off, the weather stays as it is now.', 'Kikapcsolva az időjárás úgy marad, ahogy most van.'),
        min: RULES_NEW_MIN,
        actions: [a('Changes', 'Változik', 'gamerule advance_weather true'), a('Frozen', 'Megállítva', 'gamerule advance_weather false')],
      },
    ],
  },
  {
    id: 'world',
    title: tx('World', 'Világ'),
    entries: [
      {
        id: 'difficulty',
        title: tx('Difficulty', 'Nehézség'),
        desc: tx('Peaceful has no monsters and no hunger. On Hard, zombies break doors and hunger can kill.', 'Békésen nincs szörny és éhség. Nehézen a zombik betörik az ajtót, és az éhség meg is ölhet.'),
        actions: [
          a('Peaceful', 'Békés', 'difficulty peaceful'),
          a('Easy', 'Könnyű', 'difficulty easy'),
          a('Normal', 'Normál', 'difficulty normal'),
          a('Hard', 'Nehéz', 'difficulty hard'),
        ],
      },
      {
        id: 'defaultgamemode',
        title: tx('Game mode for new players', 'Új játékosok játékmódja'),
        desc: tx('The mode a player gets the first time they join.', 'Ezt a módot kapja a játékos, amikor először lép be.'),
        actions: MODES.map(([mode, label]) => ({ label, cmd: `defaultgamemode ${mode}` })),
      },
      {
        id: 'worldspawn',
        title: tx('World spawn', 'Világ kezdőpontja'),
        desc: tx('Where new players appear, and where everyone without a bed respawns.', 'Itt jelennek meg az új játékosok, és itt éled újra mindenki, akinek nincs ágya.'),
        args: [X, Y, Z],
        actions: [a('Where the player stands', 'Ahol a játékos áll', 'execute at %p% run setworldspawn ~ ~ ~'), a('At the coordinates', 'A koordinátákra', 'setworldspawn %x% %y% %z%')],
      },
      {
        id: 'seed',
        title: tx('World seed', 'Világ seedje'),
        desc: tx('Prints the seed the world was generated from.', 'Kiírja a seedet, amiből a világ készült.'),
        actions: [a('Show the seed', 'Seed kiírása', 'seed')],
      },
      {
        id: 'locate-structure',
        title: tx('Find a structure', 'Építmény keresése'),
        desc: tx('Prints the coordinates of the nearest one to the selected player, in the console.', 'Kiírja a konzolba a kiválasztott játékoshoz legközelebbi ilyen építmény koordinátáit.'),
        min: '1.19',
        args: [{ key: 'structure', label: tx('Structure', 'Építmény'), suggest: STRUCTURES, def: '#minecraft:village' }],
        actions: [a('Find', 'Keresés', 'execute at %p% run locate structure %structure%')],
      },
      {
        id: 'locate-biome',
        title: tx('Find a biome', 'Biom keresése'),
        desc: tx('Prints the coordinates of the nearest such biome to the selected player.', 'Kiírja a kiválasztott játékoshoz legközelebbi ilyen biom koordinátáit.'),
        min: '1.19',
        args: [{ key: 'biome', label: tx('Biome', 'Biom'), suggest: BIOMES, def: 'minecraft:cherry_grove' }],
        actions: [a('Find', 'Keresés', 'execute at %p% run locate biome %biome%')],
      },
      {
        id: 'locate-old',
        title: tx('Find a structure', 'Építmény keresése'),
        desc: tx('Prints the coordinates of the nearest one to the selected player, in the console.', 'Kiírja a konzolba a kiválasztott játékoshoz legközelebbi ilyen építmény koordinátáit.'),
        max: '1.18.2',
        args: [{ key: 'structure', label: tx('Structure', 'Építmény'), suggest: ['village', 'stronghold', 'mansion', 'monument', 'fortress', 'bastion_remnant', 'endcity', 'pillager_outpost', 'mineshaft'], def: 'village' }],
        actions: [a('Find', 'Keresés', 'execute at %p% run locate %structure%')],
      },
      {
        id: 'border',
        title: tx('World border', 'Világhatár'),
        desc: tx('The width of the playable square in blocks. With seconds given, it grows or shrinks to that size gradually.', 'A játszható négyzet szélessége blokkban. Ha másodpercet is adsz, fokozatosan nő vagy zsugorodik odáig.'),
        args: [
          { key: 'size', label: tx('Width', 'Szélesség'), kind: 'number', def: '5000' },
          { key: 'seconds', label: tx('Seconds', 'Másodperc'), kind: 'number', optional: true, placeholder: '0' },
        ],
        actions: [a('Set', 'Beállítás', 'worldborder set %size% %seconds%'), a('Check', 'Lekérdezés', 'worldborder get'), a('Remove', 'Megszüntetés', 'worldborder set 59999968')],
      },
      {
        id: 'border-center',
        title: tx('World border centre', 'Világhatár középpontja'),
        desc: tx('Moves the middle of the border to the selected player or to the coordinates.', 'A határ közepét a kiválasztott játékoshoz vagy a koordinátákra teszi.'),
        args: [X, Z],
        actions: [a('On the player', 'A játékosra', 'execute at %p% run worldborder center ~ ~'), a('At the coordinates', 'A koordinátákra', 'worldborder center %x% %z%')],
      },
      {
        id: 'border-rules',
        title: tx('World border: warning and damage', 'Világhatár: figyelmeztetés és sebzés'),
        desc: tx('How many blocks before the border the screen turns red, and how much damage each block outside deals per second.', 'Hány blokkal a határ előtt vörösödik a képernyő, és mennyit sebez másodpercenként minden blokk a határon túl.'),
        args: [{ key: 'n', label: tx('Value', 'Érték'), kind: 'number', def: '5' }],
        actions: [a('Warning distance', 'Figyelmeztetési távolság', 'worldborder warning distance %n%'), a('Damage per block', 'Sebzés blokkonként', 'worldborder damage amount %n%')],
      },
      {
        id: 'forceload',
        title: tx('Keep chunks loaded', 'Chunkok betöltve tartása'),
        desc: tx('A force-loaded chunk keeps running (farms, machines) even when nobody is near. Each one costs performance.', 'A kényszerítve betöltött chunk akkor is működik (farmok, gépek), ha senki nincs a közelben. Mindegyik teljesítménybe kerül.'),
        args: [X, Z],
        actions: [
          a('Where the player stands', 'Ahol a játékos áll', 'execute at %p% run forceload add ~ ~'),
          a('At the coordinates', 'A koordinátákon', 'forceload add %x% %z%'),
          a('Release these', 'Ezek elengedése', 'forceload remove %x% %z%'),
          a('List', 'Lista', 'forceload query'),
          a('Release all', 'Mind elengedése', 'forceload remove all', true),
        ],
      },
      {
        id: 'datapacks',
        title: tx('Datapacks', 'Datapackek'),
        desc: tx('Lists the datapacks, or reloads them together with functions, recipes and loot tables after a change.', 'Kilistázza a datapackeket, vagy változtatás után újratölti őket a függvényekkel, receptekkel és loot táblákkal együtt.'),
        actions: [a('List', 'Lista', 'datapack list'), a('Reload', 'Újratöltés', 'reload')],
      },
      {
        id: 'function',
        title: tx('Run a datapack function', 'Datapack-függvény futtatása'),
        desc: tx('Runs a function from a datapack by its name (namespace:path).', 'Lefuttat egy datapack-függvényt a neve alapján (névtér:útvonal).'),
        args: [{ key: 'name', label: tx('Function', 'Függvény'), placeholder: 'namespace:path' }],
        actions: [a('Run', 'Futtatás', 'function %name%')],
      },
    ],
  },
  {
    id: 'rules',
    title: tx('Game rules', 'Játékszabályok'),
    entries: [
      ...rule('keepInventory', 'keep_inventory', tx('Keep inventory on death', 'Inventory megtartása halálkor'), tx('Players keep their items and XP when they die.', 'A játékosok halálkor megtartják a tárgyaikat és az XP-jüket.')),
      ...rule('mobGriefing', 'mob_griefing', tx('Mobs change the world', 'Mobok rombolása'), tx('Creepers blow holes, endermen carry blocks, villagers farm. Off also stops villagers from farming.', 'A creeperek lyukat robbantanak, az endermanek blokkot visznek, a falusiak gazdálkodnak. Kikapcsolva a falusiak sem aratnak.')),
      ...rule('doMobSpawning', 'spawn_mobs', tx('Natural mob spawning', 'Mobok természetes megjelenése'), tx('Monsters and animals appear by themselves. Spawners and eggs still work when off.', 'A szörnyek és az állatok maguktól megjelennek. Kikapcsolva a spawnerek és a tojások továbbra is működnek.')),
      ...rule('doFireTick', null, tx('Fire spreads', 'Tűz terjedése'), tx('Fire spreads to nearby blocks and burns out by itself.', 'A tűz átterjed a szomszédos blokkokra, és magától kialszik.')),
      ...rule('naturalRegeneration', 'natural_health_regeneration', tx('Natural healing', 'Természetes gyógyulás'), tx('Health comes back when the hunger bar is full.', 'Teli éhségcsík mellett visszatöltődik az életerő.')),
      ...rule('doImmediateRespawn', 'immediate_respawn', tx('Instant respawn', 'Azonnali újraéledés'), tx('Players respawn at once, without the death screen.', 'A játékosok azonnal újraélednek, halálképernyő nélkül.'), '1.15'),
      ...rule('doInsomnia', 'spawn_phantoms', tx('Phantoms', 'Fantomok'), tx('Phantoms attack players who have not slept for days.', 'A fantomok megtámadják azt, aki napok óta nem aludt.'), '1.15'),
      ...rule('fallDamage', 'fall_damage', tx('Fall damage', 'Esési sebzés'), tx('Players take damage from falling.', 'A játékosok sérülnek az eséstől.'), '1.15'),
      ...rule('fireDamage', 'fire_damage', tx('Fire damage', 'Tűzsebzés'), tx('Players take damage from fire and lava.', 'A játékosok sérülnek a tűztől és a lávától.'), '1.15'),
      ...rule('drowningDamage', 'drowning_damage', tx('Drowning damage', 'Fulladási sebzés'), tx('Players take damage when they run out of air.', 'A játékosok sérülnek, ha elfogy a levegőjük.'), '1.15'),
      ...rule('freezeDamage', 'freeze_damage', tx('Freezing damage', 'Fagyási sebzés'), tx('Players take damage in powder snow.', 'A játékosok sérülnek a porhóban.'), '1.17'),
      ...rule('showDeathMessages', 'show_death_messages', tx('Death messages', 'Halálüzenetek'), tx('A chat line says who died and how.', 'A chat kiírja, ki halt meg és hogyan.')),
      ...rule('announceAdvancements', 'show_advancement_messages', tx('Advancement messages', 'Achievement-üzenetek'), tx('A chat line says when someone earns an advancement.', 'A chat kiírja, ha valaki achievementet szerez.')),
      ...rule('doTileDrops', 'block_drops', tx('Blocks drop items', 'Blokkok tárgyat dobnak'), tx('A broken block drops itself as an item.', 'A kitört blokk tárgyként leesik.')),
      ...rule('doMobLoot', 'mob_drops', tx('Mobs drop loot', 'Mobok zsákmányt dobnak'), tx('Killed mobs drop items and XP.', 'A megölt mobok tárgyat és XP-t dobnak.')),
      ...rule('doEntityDrops', 'entity_drops', tx('Entities drop items', 'Entitások tárgyat dobnak'), tx('Minecarts, boats, item frames and the like drop themselves when broken.', 'A csillék, csónakok, tárgykeretek és hasonlók leesnek, ha széttöröd őket.')),
      ...rule('doTraderSpawning', 'spawn_wandering_traders', tx('Wandering traders', 'Vándorkereskedők'), tx('Wandering traders show up near players from time to time.', 'Időnként vándorkereskedő jelenik meg a játékosok közelében.'), '1.16'),
      ...rule('doPatrolSpawning', 'spawn_patrols', tx('Pillager patrols', 'Fosztogató járőrök'), tx('Patrols of pillagers roam the world.', 'Fosztogató járőrök járják a világot.'), '1.16'),
      ...rule('doWardenSpawning', 'spawn_wardens', tx('Wardens', 'Wardenek'), tx('Sculk shriekers can summon a warden.', 'A sculk sikoltók wardent idézhetnek.'), '1.19'),
      ...rule('disableRaids', null, tx('Raids disabled', 'Raidek tiltása'), tx('Switched on, villages are never raided.', 'Bekapcsolva a falvakat soha nem támadják meg raidek.'), '1.15'),
      ...rule('forgiveDeadPlayers', 'forgive_dead_players', tx('Mobs forgive dead players', 'Mobok megbocsátanak a halottnak'), tx('Angered neutral mobs calm down when the player they chase dies.', 'A feldühített semleges mobok megnyugszanak, ha az üldözött játékos meghal.'), '1.16'),
      ...rule('universalAnger', 'universal_anger', tx('Anger at everyone', 'Düh mindenkire'), tx('Angered neutral mobs attack every nearby player, not only the one who hit them.', 'A feldühített semleges mobok minden közeli játékost megtámadnak, nem csak azt, aki megütötte őket.'), '1.16'),
      ...rule('spectatorsGenerateChunks', 'spectators_generate_chunks', tx('Spectators generate terrain', 'Nézők generálnak terepet'), tx('Spectators flying into new areas make the world generate there.', 'Az új területre repülő nézők miatt ott is legenerálódik a világ.')),
      ...rule('doVinesSpread', 'spread_vines', tx('Vines spread', 'Indák terjedése'), tx('Vines grow onto neighbouring blocks.', 'Az indák ránőnek a szomszédos blokkokra.'), '1.19.4'),
      ...rule('tntExplosionDropDecay', 'tnt_explosion_drop_decay', tx('TNT destroys drops', 'TNT megsemmisíti a zsákmányt'), tx('Some of the blocks blown up by TNT are lost instead of dropping.', 'A TNT által felrobbantott blokkok egy része elvész, nem esik le.'), '1.19.3'),
      ...rule('mobExplosionDropDecay', 'mob_explosion_drop_decay', tx('Mob explosions destroy drops', 'Mob-robbanás megsemmisíti a zsákmányt'), tx('Some of the blocks blown up by creepers and the like are lost.', 'A creeperek és társaik által felrobbantott blokkok egy része elvész.'), '1.19.3'),
      ...rule('blockExplosionDropDecay', 'block_explosion_drop_decay', tx('Block explosions destroy drops', 'Blokk-robbanás megsemmisíti a zsákmányt'), tx('Some of the blocks blown up by beds and respawn anchors are lost.', 'Az ágyak és újraéledési horgonyok által felrobbantott blokkok egy része elvész.'), '1.19.3'),
      ...rule('waterSourceConversion', 'water_source_conversion', tx('Infinite water', 'Végtelen víz'), tx('Flowing water between two sources turns into a new source.', 'A két forrás közti folyó vízből új forrás lesz.'), '1.19.3'),
      ...rule('lavaSourceConversion', 'lava_source_conversion', tx('Infinite lava', 'Végtelen láva'), tx('Flowing lava between two sources turns into a new source.', 'A két forrás közti folyó lávából új forrás lesz.'), '1.19.3'),
      ...rule('globalSoundEvents', 'global_sound_events', tx('World-wide boss sounds', 'Mindenhol hallható boss-hangok'), tx('Everyone hears the wither spawning and the dragon dying, wherever they are.', 'Mindenki hallja a wither megjelenését és a sárkány halálát, bárhol is van.'), '1.19.3'),
      ...rule('enderPearlsVanishOnDeath', 'ender_pearls_vanish_on_death', tx('Ender pearls vanish on death', 'Végzetgyöngy eltűnik halálkor'), tx('A thrown ender pearl disappears when its thrower dies.', 'Az eldobott végzetgyöngy eltűnik, ha a dobója meghal.'), '1.20.2'),
      ...rule('projectilesCanBreakBlocks', 'projectiles_can_break_blocks', tx('Projectiles break blocks', 'Lövedékek blokkot törnek'), tx('Arrows and other projectiles can break pots and chorus flowers.', 'A nyilak és más lövedékek eltörhetik a cserepeket és a kóruszvirágot.'), '1.20.3'),
      ...rule('doLimitedCrafting', 'limited_crafting', tx('Only unlocked recipes', 'Csak feloldott receptek'), tx('Players can only craft the recipes they have unlocked.', 'A játékosok csak a már feloldott recepteket barkácsolhatják.')),
      ...rule('disableElytraMovementCheck', null, tx('No elytra speed check', 'Nincs elytra-sebességellenőrzés'), tx('Stops the server from pulling back players who fly “too fast”. Helps with rubber-banding on laggy servers.', 'A szerver nem rántja vissza a „túl gyorsan” repülő játékosokat. Akadozó szerveren segít a visszarángatás ellen.')),
      ...rule('commandBlockOutput', 'command_block_output', tx('Command block messages', 'Parancsblokk-üzenetek'), tx('Operators see a chat line whenever a command block runs.', 'Az operátorok chatüzenetet kapnak, amikor egy parancsblokk lefut.')),
      ...rule('sendCommandFeedback', 'send_command_feedback', tx('Command feedback', 'Parancs-visszajelzés'), tx('Commands answer in the chat of the player who ran them.', 'A parancsok válaszolnak annak a chatjében, aki futtatta őket.')),
      ...rule('logAdminCommands', 'log_admin_commands', tx('Log admin commands', 'Admin parancsok naplózása'), tx('Commands run by operators are written to the server log.', 'Az operátorok által futtatott parancsok bekerülnek a szervernaplóba.')),
      ...rule('reducedDebugInfo', 'reduced_debug_info', tx('Hide coordinates on F3', 'Koordináták elrejtése az F3-on'), tx('The F3 screen shows less: no coordinates, no hitboxes.', 'Az F3 képernyő kevesebbet mutat: nincs koordináta és hitbox.')),
      ...rule(null, 'raids', tx('Raids', 'Raidek'), tx('Switched off, villages are never raided.', 'Kikapcsolva a falvakat soha nem támadják meg raidek.')),
      ...rule(null, 'elytra_movement_check', tx('Elytra speed check', 'Elytra-sebességellenőrzés'), tx('Switched off, the server no longer pulls back players who fly “too fast”. Helps with rubber-banding on laggy servers.', 'Kikapcsolva a szerver nem rántja vissza a „túl gyorsan” repülő játékosokat. Akadozó szerveren segít a visszarángatás ellen.')),
      ...rule(null, 'pvp', tx('PvP', 'PvP'), tx('Players can hurt each other.', 'A játékosok sebezhetik egymást.')),
      ...rule(null, 'spawn_monsters', tx('Monsters spawn', 'Szörnyek megjelenése'), tx('Hostile mobs appear by themselves. Animals are not affected.', 'Az ellenséges mobok maguktól megjelennek. Az állatokra nem hat.')),
      ...rule('tntExplodes', 'tnt_explodes', tx('TNT explodes', 'TNT felrobban'), tx('Switched off, TNT can be placed but never goes off.', 'Kikapcsolva a TNT lerakható, de soha nem robban fel.'), '1.21.5'),
      ...rule('allowEnteringNetherUsingPortals', 'allow_entering_nether_using_portals', tx('Nether portals work', 'Nether-portálok működnek'), tx('Switched off, nobody can enter the Nether through a portal.', 'Kikapcsolva senki nem léphet be a Netherbe portálon át.'), '1.21.2'),
      ...rule('locatorBar', 'locator_bar', tx('Locator bar', 'Helymeghatározó sáv'), tx('The bar above the hotbar that shows which way the other players are.', 'A gyorssáv fölötti sáv, ami megmutatja, merre vannak a többiek.'), '1.21.6'),
      ...rule(null, 'command_blocks_work', tx('Command blocks work', 'Parancsblokkok működnek'), tx('Switched off, command blocks do nothing.', 'Kikapcsolva a parancsblokkok semmit nem csinálnak.')),
      ...rule(null, 'spawner_blocks_work', tx('Spawners work', 'Spawnerek működnek'), tx('Switched off, monster spawners and trial spawners stop producing mobs.', 'Kikapcsolva a szörnyidézők és a próbaidézők nem termelnek mobot.')),
      ...numberRule(null, 'fire_spread_radius_around_player', '128', tx('Fire spread radius', 'Tűz terjedési sugara'), tx('Fire only spreads within this many blocks of a player. 0 stops it spreading, -1 removes the limit.', 'A tűz csak a játékosok ekkora körzetében terjed. A 0 megállítja a terjedést, a -1 feloldja a korlátot.')),
      ...numberRule('playersSleepingPercentage', 'players_sleeping_percentage', '50', tx('Players needed to skip the night', 'Éjszaka átalvásához szükséges játékosok'), tx('The percentage of online players who must sleep. 0 means one sleeper is enough.', 'A fent lévő játékosok hány százalékának kell aludnia. A 0 azt jelenti, egy alvó is elég.'), '1.17'),
      ...numberRule('randomTickSpeed', 'random_tick_speed', '3', tx('Growth speed', 'Növekedési sebesség'), tx('How fast crops grow, leaves decay and fire spreads. 3 is normal; high values cause lag.', 'Milyen gyorsan nő a termény, hullik a levél és terjed a tűz. A 3 a normál; nagy értéknél akadozik a szerver.')),
      ...numberRule('spawnRadius', 'respawn_radius', '10', tx('Spawn area radius', 'Kezdőterület sugara'), tx('New players appear within this many blocks of the world spawn.', 'Az új játékosok a kezdőponttól ennyi blokkon belül jelennek meg.')),
      ...numberRule('maxEntityCramming', 'max_entity_cramming', '24', tx('Entity cramming limit', 'Összezsúfolási korlát'), tx('More mobs than this on one block start to suffocate. 0 switches it off.', 'Ha egy blokkon ennél több mob áll, fulladni kezdenek. A 0 kikapcsolja.')),
      ...numberRule('snowAccumulationHeight', 'max_snow_accumulation_height', '1', tx('Snow layer height', 'Hóréteg magassága'), tx('How many layers of snow can pile up while it snows (up to 8).', 'Hány réteg hó gyűlhet fel havazás közben (legfeljebb 8).'), '1.19.3'),
      ...numberRule('playersNetherPortalDefaultDelay', 'players_nether_portal_default_delay', '80', tx('Nether portal delay', 'Nether-portál késleltetés'), tx('Ticks a survival player must stand in a portal before travelling (20 ticks are one second).', 'Ennyi ticket kell a túlélő játékosnak a portálban állnia az utazásig (20 tick egy másodperc).'), '1.20.3'),
      ...numberRule('commandModificationBlockLimit', 'max_block_modifications', '32768', tx('Fill and clone limit', 'Fill és clone korlát'), tx('The most blocks one fill or clone command may change.', 'Egy fill vagy clone parancs legfeljebb ennyi blokkot változtathat.'), '1.19.4'),
    ],
  },
  {
    id: 'entities',
    title: tx('Mobs and dropped items', 'Mobok és eldobott tárgyak'),
    entries: [
      {
        id: 'clear-items',
        title: tx('Clear dropped items', 'Eldobott tárgyak törlése'),
        desc: tx('Removes every item lying on the ground, or every XP orb, in the loaded areas. Good against lag.', 'Töröl minden földön heverő tárgyat, illetve XP-gömböt a betöltött területeken. Akadozás ellen jó.'),
        actions: [a('Items', 'Tárgyak', 'kill @e[type=minecraft:item]', true), a('XP orbs', 'XP-gömbök', 'kill @e[type=minecraft:experience_orb]')],
      },
      {
        id: 'kill-type',
        title: tx('Remove one kind of mob', 'Egyfajta mob törlése'),
        desc: tx('Kills every loaded mob of this type. A modded entity id works too.', 'Megöl minden betöltött, ilyen típusú mobot. Modos entitás azonosítója is megy.'),
        args: [{ key: 'mob', label: tx('Mob', 'Mob'), suggest: MOBS, def: 'minecraft:zombie' }],
        actions: [a('Remove', 'Törlés', 'kill @e[type=%mob%]', true)],
      },
      {
        id: 'kill-near',
        title: tx('Remove everything near the player', 'Minden törlése a játékos körül'),
        desc: tx('Kills every entity except players within this many blocks of the selected player: monsters, but also animals, villagers, pets, item frames and armour stands.', 'A kiválasztott játékos ekkora körzetében megöl minden entitást a játékosokon kívül: szörnyeket, de állatokat, falusiakat, háziállatokat, tárgykereteket és páncélállványokat is.'),
        args: [{ key: 'radius', label: tx('Radius', 'Sugár'), kind: 'number', def: '32' }],
        actions: [a('Remove', 'Törlés', 'execute at %p% run kill @e[type=!minecraft:player,distance=..%radius%]', true)],
      },
      {
        id: 'count',
        title: tx('Count entities', 'Entitások megszámolása'),
        desc: tx('Prints how many entities, or how many dropped items, are loaded right now. Tens of thousands mean lag.', 'Kiírja, hány entitás, illetve hány eldobott tárgy van most betöltve. A több tízezer már akadozást jelent.'),
        actions: [a('All entities', 'Minden entitás', 'execute if entity @e'), a('Dropped items', 'Eldobott tárgyak', 'execute if entity @e[type=minecraft:item]')],
      },
    ],
  },
  {
    id: 'scoreboard',
    title: tx('Scoreboards and teams', 'Scoreboardok és csapatok'),
    entries: [
      {
        id: 'sb-deaths',
        title: tx('Death counter', 'Halálszámláló'),
        desc: tx('Counts everyone’s deaths and shows them in the player list (Tab). Create it first, then show it.', 'Számolja mindenki halálait, és megmutatja a játékoslistában (Tab). Előbb hozd létre, aztán jelenítsd meg.'),
        actions: [
          a('Create', 'Létrehozás', 'scoreboard objectives add deaths deathCount'),
          a('Show in the list', 'Megjelenítés a listában', 'scoreboard objectives setdisplay list deaths'),
          a('Hide', 'Elrejtés', 'scoreboard objectives setdisplay list'),
          a('Delete', 'Törlés', 'scoreboard objectives remove deaths', true),
        ],
      },
      {
        id: 'sb-kills',
        title: tx('Player kill counter', 'Játékosölés-számláló'),
        desc: tx('Counts PvP kills and shows them on the right side of the screen. Create it first, then show it.', 'Számolja a PvP öléseket, és megmutatja a képernyő jobb oldalán. Előbb hozd létre, aztán jelenítsd meg.'),
        actions: [
          a('Create', 'Létrehozás', 'scoreboard objectives add kills playerKillCount'),
          a('Show on the side', 'Megjelenítés oldalt', 'scoreboard objectives setdisplay sidebar kills'),
          a('Hide', 'Elrejtés', 'scoreboard objectives setdisplay sidebar'),
          a('Delete', 'Törlés', 'scoreboard objectives remove kills', true),
        ],
      },
      {
        id: 'sb-health-old',
        title: tx('Health under names', 'Életerő a nevek alatt'),
        desc: tx('Shows every player’s health under their name tag. Create it first, then show it.', 'Minden játékos életerejét kiírja a névtáblája alá. Előbb hozd létre, aztán jelenítsd meg.'),
        max: '1.20.1',
        actions: [
          a('Create', 'Létrehozás', 'scoreboard objectives add health health'),
          a('Show', 'Megjelenítés', 'scoreboard objectives setdisplay belowName health'),
          a('Hide', 'Elrejtés', 'scoreboard objectives setdisplay belowName'),
          a('Delete', 'Törlés', 'scoreboard objectives remove health', true),
        ],
      },
      {
        id: 'sb-health',
        title: tx('Health under names', 'Életerő a nevek alatt'),
        desc: tx('Shows every player’s health under their name tag. Create it first, then show it.', 'Minden játékos életerejét kiírja a névtáblája alá. Előbb hozd létre, aztán jelenítsd meg.'),
        min: '1.20.2',
        actions: [
          a('Create', 'Létrehozás', 'scoreboard objectives add health health'),
          a('Show', 'Megjelenítés', 'scoreboard objectives setdisplay below_name health'),
          a('Hide', 'Elrejtés', 'scoreboard objectives setdisplay below_name'),
          a('Delete', 'Törlés', 'scoreboard objectives remove health', true),
        ],
      },
      {
        id: 'sb-list',
        title: tx('Existing scoreboards', 'Meglévő scoreboardok'),
        desc: tx('Prints every scoreboard objective, or the selected player’s scores.', 'Kiírja az összes scoreboard-célt, vagy a kiválasztott játékos pontjait.'),
        actions: [a('Objectives', 'Célok', 'scoreboard objectives list'), a('The player’s scores', 'A játékos pontjai', 'scoreboard players list %p%')],
      },
      {
        id: 'team',
        title: tx('Teams', 'Csapatok'),
        desc: tx('A team gives its members a name colour, and can switch off friendly fire between them.', 'A csapat névszínt ad a tagjainak, és kikapcsolható benne az egymásra lövés.'),
        args: [
          { key: 'team', label: tx('Team', 'Csapat'), def: 'red', placeholder: 'red' },
          { key: 'color', label: tx('Colour', 'Szín'), kind: 'select', options: COLORS, def: 'red' },
        ],
        actions: [
          a('Create', 'Létrehozás', 'team add %team%'),
          a('Add the player', 'Játékos felvétele', 'team join %team% %p%'),
          a('Remove the player', 'Játékos kivétele', 'team leave %p%'),
          a('Set colour', 'Szín beállítása', 'team modify %team% color %color%'),
          a('Friendly fire off', 'Baráti tűz ki', 'team modify %team% friendlyFire false'),
          a('Friendly fire on', 'Baráti tűz be', 'team modify %team% friendlyFire true'),
          a('List', 'Lista', 'team list'),
          a('Delete', 'Törlés', 'team remove %team%', true),
        ],
      },
    ],
  },
  {
    id: 'server',
    title: tx('Server and performance', 'Szerver és teljesítmény'),
    entries: [
      {
        id: 'save',
        title: tx('Saving', 'Mentés'),
        desc: tx('Saves the world right now. With auto-save off the world is only saved when you ask, so switch it back on after a manual backup.', 'Azonnal lementi a világot. Kikapcsolt automata mentésnél csak kérésre ment, ezért kézi biztonsági mentés után kapcsold vissza.'),
        actions: [a('Save now', 'Mentés most', 'save-all'), a('Save and flush', 'Mentés és kiírás', 'save-all flush'), a('Auto-save off', 'Automata mentés ki', 'save-off', true), a('Auto-save on', 'Automata mentés be', 'save-on')],
      },
      {
        id: 'tick',
        title: tx('Game speed', 'Játéksebesség'),
        desc: tx('The server normally runs 20 ticks per second. A lower rate slows the whole world down; freezing stops everything except players.', 'A szerver alapból másodpercenként 20 ticket fut. Kisebb értéknél az egész világ lelassul; a fagyasztás a játékosokon kívül mindent megállít.'),
        min: '1.20.3',
        args: [{ key: 'rate', label: tx('Ticks per second', 'Tick/másodperc'), kind: 'number', def: '20' }],
        actions: [a('Set rate', 'Sebesség beállítása', 'tick rate %rate%'), a('Check', 'Lekérdezés', 'tick query'), a('Freeze', 'Fagyasztás', 'tick freeze', true), a('Unfreeze', 'Kiolvasztás', 'tick unfreeze')],
      },
      {
        id: 'tick-sprint',
        title: tx('Fast-forward', 'Előretekerés'),
        desc: tx('Runs this many ticks as fast as the machine can (crops grow, furnaces finish), then reports the real speed.', 'Ennyi ticket futtat le olyan gyorsan, ahogy a gép bírja (nő a termény, kisülnek a kemencék), aztán kiírja a valós sebességet.'),
        min: '1.20.3',
        args: [{ key: 'n', label: tx('Ticks', 'Tick'), kind: 'number', def: '1200' }],
        actions: [a('Sprint', 'Tekerés', 'tick sprint %n%')],
      },
      {
        id: 'perf',
        title: tx('Performance report', 'Teljesítményjelentés'),
        desc: tx('Measures the server for ten seconds and saves a report into its debug folder.', 'Tíz másodpercig méri a szervert, és jelentést ment a debug mappájába.'),
        min: '1.17',
        actions: [a('Start', 'Indítás', 'perf start'), a('Stop early', 'Leállítás előbb', 'perf stop')],
      },
      {
        id: 'debug',
        title: tx('Profiler', 'Profilozó'),
        desc: tx('Records what the server spends its time on, between start and stop, and saves it into the debug folder.', 'Rögzíti, mire megy el a szerver ideje az indítás és a leállítás között, és a debug mappába menti.'),
        actions: [a('Start', 'Indítás', 'debug start'), a('Stop', 'Leállítás', 'debug stop')],
      },
      {
        id: 'forge',
        title: tx('Forge tools', 'Forge eszközök'),
        desc: tx('Ticks per second for each dimension, the loaded mods, the entity count by type, and the dimensions.', 'Tick/másodperc dimenziónként, a betöltött modok, az entitások száma típusonként, és a dimenziók.'),
        loaders: ['forge'],
        actions: [a('TPS', 'TPS', 'forge tps'), a('Mods', 'Modok', 'forge mods'), a('Entities', 'Entitások', 'forge entity list'), a('Dimensions', 'Dimenziók', 'forge dimensions')],
      },
      {
        id: 'neoforge',
        title: tx('NeoForge tools', 'NeoForge eszközök'),
        desc: tx('Ticks per second for each dimension, the loaded mods, the entity count by type, and the dimensions.', 'Tick/másodperc dimenziónként, a betöltött modok, az entitások száma típusonként, és a dimenziók.'),
        loaders: ['neoforge'],
        actions: [a('TPS', 'TPS', 'neoforge tps'), a('Mods', 'Modok', 'neoforge mods'), a('Entities', 'Entitások', 'neoforge entity list'), a('Dimensions', 'Dimenziók', 'neoforge dimensions')],
      },
      {
        id: 'help',
        title: tx('Help', 'Súgó'),
        desc: tx('Lists every command this server knows (mods add their own), or explains one of them.', 'Kilistázza a szerver összes parancsát (a modok is adnak hozzá), vagy elmagyaráz egyet.'),
        args: [{ key: 'command', label: tx('Command', 'Parancs'), optional: true, placeholder: 'gamerule' }],
        actions: [a('Help', 'Súgó', 'help %command%')],
      },
    ],
  },
];

/** The buttons that are always visible above the catalogue: the entries an admin reaches for most. */
export const QUICK: { title: Text; ids: string[] }[] = [
  { title: tx('Player', 'Játékos'), ids: ['op', 'gamemode', 'vitals', 'kick'] },
  { title: tx('Whitelist', 'Whitelist'), ids: ['wl-player', 'wl-switch'] },
  { title: tx('Time of day', 'Napszak'), ids: ['time'] },
  { title: tx('Weather', 'Időjárás'), ids: ['weather'] },
  { title: tx('Difficulty', 'Nehézség'), ids: ['difficulty'] },
  { title: tx('Server', 'Szerver'), ids: ['save', 'list'] },
];
