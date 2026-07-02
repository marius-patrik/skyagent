import { describe, expect, test } from "bun:test";
import { compactProfileOverview } from "../src/profile.ts";

describe("profile overview", () => {
  test("reports current inventory, pet, and loadout API signals", () => {
    const overview = compactProfileOverview({
      uuid: "player-uuid",
      profile: {
        profile_id: "profile-id",
        cute_name: "Apple",
        members: { "player-uuid": {} },
        banking: { balance: 0 },
      },
      profiles: [],
      member: {
        currencies: { coin_purse: 0 },
        inventory: {
          bag_contents: {
            talisman_bag: { data: "encoded" },
            sacks_bag: { data: "encoded" },
          },
          ender_chest_contents: { data: "encoded" },
          inv_armor: { data: "encoded" },
          inv_contents: { data: "encoded" },
          backpack_contents: {},
          personal_vault_contents: { data: "encoded" },
        },
        loadout: {
          armor: {
            "1": {},
          },
        },
        profile_member_id: "player-uuid",
        pets_data: {
          pets: [],
        },
        player_data: { experience: {} },
      },
      rateLimit: null,
    });

    expect(overview.inventoryApiSignals).toMatchObject({
      hasInventoryBag: true,
      hasInventory: true,
      hasEnderChest: true,
      hasBackpacks: true,
      hasPersonalVault: true,
      hasSacks: true,
      hasArmor: true,
      hasEquipment: false,
      hasWardrobe: true,
      hasAccessoryBag: true,
      hasPets: true,
    });
    expect(overview.profileCompleteness).toMatchObject({
      selectedMember: {
        uuid: "player-uuid",
        memberPresent: true,
        profileMemberId: "player-uuid",
      },
      coop: {
        memberCount: 1,
        selectedMemberPresent: true,
      },
    });
    expect(overview.inventoryApiDetails.sacks).toMatchObject({
      status: "present",
      sourcePath: "member.inventory.bag_contents.sacks_bag",
    });
    expect(overview.inventoryApiDetails.equipment).toMatchObject({
      status: "api_disabled_or_missing",
      available: false,
    });
  });

  test("does not infer selected member presence from fallback member data", () => {
    const overview = compactProfileOverview({
      uuid: "selected-uuid",
      profile: {
        profile_id: "profile-id",
        cute_name: "Apple",
        members: { "other-uuid": {} },
      },
      profiles: [],
      member: {
        profile_member_id: "selected-uuid",
        currencies: { coin_purse: 0 },
        player_data: { experience: {} },
      },
      rateLimit: null,
    });

    expect(overview.profileCompleteness).toMatchObject({
      selectedMember: {
        uuid: "selected-uuid",
        memberPresent: false,
        profileMemberId: "selected-uuid",
        sourcePath: null,
      },
      coop: {
        memberCount: 1,
        otherMemberCount: 1,
        selectedMemberPresent: false,
        memberIdsKnown: true,
      },
    });
  });

  test("does not treat another coop member museum entry as selected member museum data", () => {
    const overview = compactProfileOverview({
      uuid: "selected-uuid",
      profile: {
        profile_id: "profile-id",
        cute_name: "Apple",
        members: { "selected-uuid": {}, "other-uuid": {} },
        museum: {
          members: {
            "other-uuid": { items: { HYPERION: {} } },
          },
        },
      },
      profiles: [],
      member: {
        player_data: { experience: {} },
      },
      rateLimit: null,
    });

    expect(overview.museum).toMatchObject({
      status: "missing",
      available: false,
      memberScoped: false,
      coopMemberMuseumCount: 1,
      itemCount: 0,
    });
    expect(overview.profileCompleteness.profileAvailability.museumAvailable).toBe(false);
  });
});
