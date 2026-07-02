import { readConfig } from "./store.ts";
import { skyblockProfiles, uuidFromNameOrUuid } from "./hypixel.ts";

export function skycryptUrl(usernameOrUuid, profileName) {
  const base = `https://sky.shiiyu.moe/stats/${encodeURIComponent(usernameOrUuid)}`;
  return profileName ? `${base}/${encodeURIComponent(profileName)}` : base;
}

function normalizeProfileName(value) {
  return String(value || "").trim().toLowerCase();
}

export function profileSummaries(profiles = [], uuid) {
  return profiles.map((profile) => {
    const member = profile.members?.[uuid] ?? null;
    return {
      profileId: profile.profile_id,
      cuteName: profile.cute_name ?? null,
      selected: Boolean(profile.selected),
      gameMode: profile.game_mode ?? "normal",
      memberPresent: Boolean(member),
      lastSave: member?.last_save ?? null,
      purse: member?.currencies?.coin_purse ?? member?.coin_purse ?? null,
      bank: profile.banking?.balance ?? null,
      skyblockLevelXp: member?.leveling?.experience ?? null,
    };
  });
}

export function chooseProfile(profiles, selector) {
  if (!profiles?.length) {
    throw new Error("No SkyBlock profiles were returned for this player.");
  }

  const config = readConfig();
  const requested = selector ?? config.selectedProfileId ?? null;

  if (requested) {
    const normalized = normalizeProfileName(requested);
    const match = profiles.find((profile) => (
      normalizeProfileName(profile.profile_id) === normalized ||
      normalizeProfileName(profile.cute_name) === normalized
    ));
    if (!match) {
      throw new Error(`SkyBlock profile not found: ${requested}`);
    }
    return match;
  }

  return profiles.find((profile) => profile.selected) ?? profiles[0];
}

export async function fetchProfileContext(player, selector) {
  const uuid = await uuidFromNameOrUuid(player);
  const response = await skyblockProfiles(uuid);
  const profiles = response.body?.profiles ?? [];
  const profile = chooseProfile(profiles, selector);
  const member = profile.members?.[uuid] ?? null;
  if (!member) {
    throw new Error(`Selected profile does not contain member ${uuid}.`);
  }

  return {
    uuid,
    profile,
    member,
    profiles: profileSummaries(profiles, uuid),
    rateLimit: response.rateLimit,
  };
}

function objectKeys(value) {
  return value && typeof value === "object" ? Object.keys(value) : [];
}

function getPath(root, path) {
  return path.reduce((value, key) => value?.[key], root);
}

function firstAvailablePath(root, paths) {
  for (const path of paths) {
    const value = getPath(root, path);
    if (value !== undefined && value !== null) {
      return { value, path: `member.${path.join(".")}` };
    }
  }
  return { value: null, path: null };
}

function availabilityDetail(root, label, paths) {
  const { value, path } = firstAvailablePath(root, paths);
  if (value === null) {
    return {
      label,
      status: "api_disabled_or_missing",
      available: false,
      presentEmpty: false,
      sourcePath: null,
      warnings: [{
        code: "api_disabled_or_missing",
        message: `${label} data is absent from the selected profile payload; the API section may be disabled or the payload may be partial.`,
        sourcePath: null,
      }],
    };
  }
  const count = Array.isArray(value)
    ? value.length
    : value && typeof value === "object"
      ? Object.keys(value).length
      : null;
  return {
    label,
    status: count === 0 ? "present_empty" : "present",
    available: true,
    presentEmpty: count === 0,
    sourcePath: path,
    keyCount: count,
    warnings: [],
  };
}

function museumSignals(uuid, profile, member) {
  const memberId = member?.profile_member_id ?? uuid;
  const museumMembers = profile?.museum?.members && typeof profile.museum.members === "object" ? profile.museum.members : null;
  const memberMuseum = museumMembers?.[memberId] ?? museumMembers?.[uuid] ?? member?.museum ?? null;
  const profileMuseum = !museumMembers ? profile?.museum ?? null : null;
  const museum = memberMuseum ?? profileMuseum;
  return {
    status: museum ? "present" : "missing",
    available: Boolean(museum),
    sourcePath: memberMuseum ? "profile.museum.selected_member" : profileMuseum ? "profile.museum" : null,
    memberScoped: Boolean(memberMuseum),
    coopMemberMuseumCount: museumMembers ? objectKeys(museumMembers).length : null,
    itemCount: objectKeys(museum?.items).length,
    specialItemCount: objectKeys(museum?.special).length,
    value: museum?.value ?? null,
  };
}

export function compactProfileOverview(context) {
  const { uuid, profile, member, profiles, rateLimit } = context;
  const playerData = member.player_data ?? {};
  const currencies = member.currencies ?? {};
  const slayers = member.slayer?.slayer_bosses ?? {};
  const dungeons = member.dungeons ?? {};
  const skills = playerData.experience ?? {};
  const inventoryDetails = {
    inventory: availabilityDetail(member, "Inventory", [["inventory", "inv_contents"], ["inv_contents"]]),
    enderChest: availabilityDetail(member, "Ender Chest", [["inventory", "ender_chest_contents"], ["ender_chest_contents"]]),
    backpacks: availabilityDetail(member, "Backpacks", [["inventory", "backpack_contents"], ["backpack_contents"]]),
    personalVault: availabilityDetail(member, "Personal Vault", [["inventory", "personal_vault_contents"], ["personal_vault_contents"]]),
    sacks: availabilityDetail(member, "Sacks", [["inventory", "bag_contents", "sacks_bag"], ["bag_contents", "sacks_bag"], ["sacks_bag"]]),
    armor: availabilityDetail(member, "Armor", [["inventory", "inv_armor"], ["inv_armor"]]),
    equipment: availabilityDetail(member, "Equipment", [["inventory", "equipment_contents"], ["equipment_contents"], ["inventory", "equippment_contents"], ["equippment_contents"]]),
    wardrobe: availabilityDetail(member, "Wardrobe", [["inventory", "wardrobe_contents"], ["wardrobe_contents"], ["loadout", "armor"]]),
    accessoryBag: availabilityDetail(member, "Accessory Bag", [["inventory", "bag_contents", "talisman_bag"], ["inventory", "bag_contents"], ["talisman_bag"], ["bag_contents"]]),
    pets: availabilityDetail(member, "Pets", [["pets_data", "pets"], ["pets"]]),
  };
  const memberIds = objectKeys(profile.members);
  const selectedMemberPresent = Boolean(profile.members?.[uuid]);
  const museum = museumSignals(uuid, profile, member);

  return {
    uuid,
    selectedProfile: {
      profileId: profile.profile_id,
      cuteName: profile.cute_name ?? null,
      selected: Boolean(profile.selected),
      gameMode: profile.game_mode ?? "normal",
    },
    profiles,
    economy: {
      purse: currencies.coin_purse ?? member.coin_purse ?? null,
      bank: profile.banking?.balance ?? null,
    },
    progression: {
      skyblockLevelXp: member.leveling?.experience ?? null,
      skillExperienceKeys: objectKeys(skills),
      slayerBosses: objectKeys(slayers),
      dungeonTypes: objectKeys(dungeons.dungeon_types),
      dungeonClasses: objectKeys(dungeons.player_classes),
      collections: objectKeys(member.collection),
      craftedGenerators: member.player_data?.crafted_generators?.length ?? member.crafted_generators?.length ?? null,
      unlockedCollections: member.player_data?.unlocked_coll_tiers?.length ?? member.unlocked_coll_tiers?.length ?? null,
    },
    inventoryApiSignals: {
      hasInventoryBag: Boolean(member.inventory?.bag_contents || member.bag_contents),
      hasInventory: inventoryDetails.inventory.available,
      hasEnderChest: inventoryDetails.enderChest.available,
      hasBackpacks: inventoryDetails.backpacks.available,
      hasPersonalVault: inventoryDetails.personalVault.available,
      hasSacks: inventoryDetails.sacks.available,
      hasArmor: inventoryDetails.armor.available,
      hasEquipment: inventoryDetails.equipment.available,
      hasWardrobe: inventoryDetails.wardrobe.available,
      hasAccessoryBag: inventoryDetails.accessoryBag.available,
      hasPets: inventoryDetails.pets.available,
      hasMuseum: museum.available,
    },
    inventoryApiDetails: inventoryDetails,
    profileCompleteness: {
      selectedMember: {
        uuid,
        memberPresent: selectedMemberPresent,
        profileMemberId: member.profile_member_id ?? null,
        sourcePath: selectedMemberPresent ? "profile.selected_member" : null,
      },
      coop: {
        memberCount: memberIds.length,
        otherMemberCount: Math.max(0, memberIds.filter((id) => id !== uuid).length),
        selectedMemberPresent,
        memberIdsKnown: memberIds.length > 0,
      },
      profileAvailability: {
        profileId: profile.profile_id,
        cuteName: profile.cute_name ?? null,
        selected: Boolean(profile.selected),
        gameMode: profile.game_mode ?? "normal",
        bankAvailable: profile.banking?.balance !== undefined && profile.banking?.balance !== null,
        museumAvailable: museum.available,
      },
    },
    museum,
    rateLimit,
  };
}

