import { assert, ids, ConnecteamError } from "./connecteam.js";

export const TEMP_OPTION_BASE = 9_007_199_240_000_000;

export function selectedOptionIds(user, fieldId) {
  const value = user?.customFields?.find(
    (field) => Number(field.customFieldId ?? field.fieldId) === Number(fieldId),
  )?.value;
  if (value == null || value === "") return [];
  if (!Array.isArray(value))
    throw new ConnecteamError(
      "Unexpected dropdown value; refusing to overwrite it.",
      502,
    );
  return [
    ...new Set(
      value.map((item) => Number(typeof item === "object" ? item.id : item)),
    ),
  ].filter((id) => Number.isSafeInteger(id) && id > 0);
}

export function memberGroupIds(user) {
  const raw = user?.smartGroupsIds || user?.smartGroupIds || [];
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0),
    ),
  ];
}

// Job sources are alternatives: any selected group or any selected tag qualifies
// the person for the job. Brand sources are alternatives too. The brand
// assignment itself is the intersection of those two results.
export function qualifiesForJob(user, cohort) {
  const groups = new Set(cohort?.groupIds || []);
  const options = new Set(cohort?.optionIds || []);
  if (!groups.size && !options.size) return false;
  const inGroup = memberGroupIds(user).some((id) => groups.has(id));
  const hasOption = options.size
    ? selectedOptionIds(user, cohort.fieldId).some((id) => options.has(id))
    : false;
  return inGroup || hasOption;
}

export function qualifiesForBrand(user, brand) {
  const groups = new Set(brand?.groupIds || []);
  const inGroup = memberGroupIds(user).some((id) => groups.has(id));
  const hasOption =
    brand?.optionId != null &&
    selectedOptionIds(user, brand.fieldId).includes(Number(brand.optionId));
  if (brand?.optionId == null && !groups.size) return false;
  return hasOption || inGroup;
}

export function eligibilityMatrix(users, { cohort, brands }) {
  return (brands || []).map((brand) => ({
    key: brand.key,
    title: brand.title,
    userIds: (users || [])
      .filter(
        (user) =>
          qualifiesForJob(user, cohort) && qualifiesForBrand(user, brand),
      )
      .map((user) => Number(user.userId))
      .sort((a, b) => a - b),
  }));
}

function dropdownField(fields, fieldId, label) {
  const field = (fields || []).find(
    (item) =>
      item.id === fieldId && item.type === "dropdown" && !item.isDeleted,
  );
  assert(field, `${label} must be an existing dropdown custom field.`, 400);
  assert(
    field.isMultiSelect === true,
    `${field.name} must allow multiple selections so a person can qualify for more than one job or brand.`,
    400,
  );
  return field;
}

function liveOption(field, optionId) {
  const option = field.dropdownOptions?.find(
    (item) => item.id === optionId && !item.isDeleted && !item.isDisabled,
  );
  assert(
    option,
    `Option ${optionId} is not a valid choice for ${field.name}.`,
    400,
  );
  return option;
}

function appendOption(before, optionRef) {
  return before.includes(optionRef) ? before : [...before, optionRef];
}

export function buildEligibilityPlan({
  input,
  users = [],
  fields = [],
  segments = [],
  groups = [],
}) {
  const raw = input?.eligibility;
  assert(
    raw && typeof raw === "object" && !Array.isArray(raw),
    "Eligibility details are missing.",
  );
  assert(
    Array.isArray(input.subJobs) && input.subJobs.length > 0,
    "Add a brand for each eligibility group.",
  );
  assert(
    input.subJobs.length <= 100,
    "Create at most 100 brand groups in one eligibility setup.",
  );
  const doorField = dropdownField(
    fields,
    ids([raw.doorFieldId], "Job field IDs")[0],
    "The job field",
  );
  const brandField = dropdownField(
    fields,
    ids([raw.brandFieldId], "Brand field IDs")[0],
    "The brand field",
  );
  assert(
    doorField.id !== brandField.id,
    "Use one dropdown for the job and a different dropdown for brands.",
  );
  const doorTitle = typeof input.title === "string" ? input.title.trim() : "";
  assert(doorTitle, "Enter the job name before building eligibility.");

  const options = [];
  let tempCursor = TEMP_OPTION_BASE;
  const reserveOption = (fieldId, value) => {
    const tempId = tempCursor++;
    assert(
      Number.isSafeInteger(tempId),
      "Could not reserve an id for a new dropdown option.",
    );
    options.push({
      key: `opt-${options.length}`,
      fieldId,
      fieldName: fieldId === doorField.id ? doorField.name : brandField.name,
      value,
      tempId,
    });
    return tempId;
  };

  let doorOptionRef;
  let doorOptionLabel;
  if (raw.doorOptionId != null && raw.doorOptionId !== "") {
    const option = liveOption(
      doorField,
      ids([raw.doorOptionId], "Job option IDs")[0],
    );
    doorOptionRef = option.id;
    doorOptionLabel = option.value;
  } else {
    const value = (raw.doorValue || doorTitle).trim();
    assert(
      value && value.length <= 128,
      "The job tag must contain 1–128 characters.",
    );
    assert(
      !doorField.dropdownOptions?.some(
        (option) =>
          !option.isDeleted &&
          option.value.toLowerCase() === value.toLowerCase(),
      ),
      `“${value}” already exists on ${doorField.name}. Select it instead of creating it.`,
      409,
    );
    doorOptionRef = reserveOption(doorField.id, value);
    doorOptionLabel = value;
  }

  const cohortGroupIds = ids(raw.cohortGroupIds || [], "Cohort group IDs");
  const knownGroups = new Set(groups.map((group) => group.id));
  for (const groupId of cohortGroupIds)
    assert(
      knownGroups.has(groupId),
      `Smart group ${groupId} is not available for the job cohort. Refresh and choose it again.`,
      409,
    );
  const cohortOptionIds = ids(raw.cohortOptionIds || [], "Cohort option IDs");
  for (const optionId of cohortOptionIds) liveOption(doorField, optionId);
  const cohort = {
    fieldId: doorField.id,
    groupIds: cohortGroupIds,
    optionIds: cohortOptionIds,
  };

  let groupSegmentId = null;
  let segment = null;
  const segmentChoice = raw.groupSegmentId ?? raw.segmentId;
  if (
    segmentChoice != null &&
    segmentChoice !== "" &&
    String(segmentChoice) !== "new"
  ) {
    groupSegmentId = ids([segmentChoice], "Segment IDs")[0];
    assert(
      segments.some((item) => item.id === groupSegmentId),
      `Segment ${groupSegmentId} is not a valid segment.`,
      400,
    );
  } else {
    const segmentName = (raw.segmentName || `${doorTitle} eligibility`).trim();
    assert(
      segmentName && segmentName.length <= 128,
      "The segment name must contain 1–128 characters.",
    );
    assert(
      !segments.some(
        (item) => item.name.toLowerCase() === segmentName.toLowerCase(),
      ),
      `Segment “${segmentName}” already exists. Select it instead of creating a new one.`,
      409,
    );
    const color =
      typeof raw.color === "string" && raw.color.trim()
        ? raw.color.trim().toLowerCase()
        : "#3968bb";
    assert(
      /^#[0-9a-f]{6}$/.test(color),
      "Segment color must be a #RRGGBB hex code.",
    );
    segment = { name: segmentName, color };
  }

  const usedOptionValues = new Set(
    doorField.id === brandField.id ? [doorOptionLabel.toLowerCase()] : [],
  );
  const brandPlans = input.subJobs.map((sub, index) => {
    const titleText = typeof sub?.title === "string" ? sub.title.trim() : "";
    assert(titleText, "Each brand needs a name.");
    const sourceGroupIds = ids(sub.brandGroupIds || [], "Brand group IDs");
    for (const groupId of sourceGroupIds)
      assert(
        knownGroups.has(groupId),
        `Smart group ${groupId} is not available for ${titleText}.`,
        409,
      );
    let optionRef;
    let optionLabel;
    let matchOptionId = null;
    if (sub.brandOptionId != null && sub.brandOptionId !== "") {
      const option = liveOption(
        brandField,
        ids([sub.brandOptionId], "Brand option IDs")[0],
      );
      optionRef = option.id;
      optionLabel = option.value;
      matchOptionId = option.id;
    } else {
      const value = (sub.brandValue || titleText).trim();
      assert(
        value && value.length <= 128,
        `The brand tag for “${titleText}” must contain 1–128 characters.`,
      );
      assert(
        !usedOptionValues.has(value.toLowerCase()),
        `Brand tag “${value}” is used more than once.`,
        409,
      );
      assert(
        !brandField.dropdownOptions?.some(
          (option) =>
            !option.isDeleted &&
            option.value.toLowerCase() === value.toLowerCase(),
        ),
        `“${value}” already exists on ${brandField.name}. Select it instead of creating it.`,
        409,
      );
      usedOptionValues.add(value.toLowerCase());
      optionRef = reserveOption(brandField.id, value);
      optionLabel = value;
    }
    const groupName = `${doorTitle} — ${titleText}`;
    assert(
      groupName.length <= 128,
      `“${groupName}” is longer than 128 characters. Shorten the job or brand name.`,
    );
    return {
      index,
      key: `elig-b${index}`,
      title: titleText,
      optionRef,
      optionLabel,
      matchOptionId,
      sourceGroupIds,
      groupName,
    };
  });

  const jobGroupName = doorTitle;
  const reservedNames = new Set(
    groups.map((group) =>
      String(group.name || "")
        .trim()
        .toLowerCase(),
    ),
  );
  for (const name of [
    jobGroupName,
    ...brandPlans.map((brand) => brand.groupName),
  ]) {
    assert(
      !reservedNames.has(name.toLowerCase()),
      `Smart group “${name}” already exists. Select it instead of creating it.`,
      409,
    );
    reservedNames.add(name.toLowerCase());
  }

  const filter = (field, optionRef, optionLabel) => ({
    fieldId: field.id,
    optionIds: [optionRef],
    fieldName: field.name,
    optionNames: [optionLabel],
  });
  const baseSpec = {
    description: "",
    groupSegmentId,
    segment,
    filtersOperator: "and",
  };
  const specs = [
    {
      ...baseSpec,
      key: "elig-job",
      name: jobGroupName,
      description: `People tagged ${doorOptionLabel} on ${doorField.name}.`,
      filters: {
        operator: "and",
        dropdownFilters: [filter(doorField, doorOptionRef, doorOptionLabel)],
      },
    },
    ...brandPlans.map((brand) => ({
      ...baseSpec,
      key: brand.key,
      name: brand.groupName,
      description: `People tagged ${doorOptionLabel} and ${brand.optionLabel}.`,
      filters: {
        operator: "and",
        dropdownFilters: [
          filter(doorField, doorOptionRef, doorOptionLabel),
          filter(brandField, brand.optionRef, brand.optionLabel),
        ],
      },
    })),
  ];

  const matrix = eligibilityMatrix(users, {
    cohort,
    brands: brandPlans.map((brand) => ({
      key: brand.key,
      title: brand.title,
      fieldId: brandField.id,
      optionId: brand.matchOptionId,
      groupIds: brand.sourceGroupIds,
    })),
  });
  const eligibleByBrand = new Map(
    matrix.map((row) => [row.key, new Set(row.userIds)]),
  );
  const userUpdates = [];
  let alreadyTagged = 0;
  const jobQualified = [];
  for (const user of users) {
    if (!qualifiesForJob(user, cohort)) continue;
    const userId = ids([user.userId], "User IDs")[0];
    jobQualified.push(userId);
    const doorBefore = selectedOptionIds(user, doorField.id);
    let doorAfter = appendOption(doorBefore, doorOptionRef);
    const brandBefore = selectedOptionIds(user, brandField.id);
    let brandAfter = brandBefore;
    const matchedBrands = [];
    for (const brand of brandPlans) {
      if (!eligibleByBrand.get(brand.key)?.has(userId)) continue;
      matchedBrands.push(brand.title);
      brandAfter = appendOption(brandAfter, brand.optionRef);
    }
    const doorChanged = stableIds(doorBefore) !== stableIds(doorAfter);
    const brandChanged = stableIds(brandBefore) !== stableIds(brandAfter);
    if (!doorChanged && !brandChanged) {
      if (matchedBrands.length) alreadyTagged += 1;
      continue;
    }
    const fieldsToWrite = [];
    if (doorChanged)
      fieldsToWrite.push({
        fieldId: doorField.id,
        fieldName: doorField.name,
        before: doorBefore,
        after: doorAfter,
      });
    if (brandChanged)
      fieldsToWrite.push({
        fieldId: brandField.id,
        fieldName: brandField.name,
        before: brandBefore,
        after: brandAfter,
      });
    userUpdates.push({
      userId,
      label:
        `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
        `User ${userId}`,
      brands: matchedBrands,
      fields: fieldsToWrite,
    });
  }
  assert(
    userUpdates.length <= 100,
    `${userUpdates.length} people need tag updates. Narrow the job cohort and preview again (maximum 100 per setup).`,
  );

  return {
    specs,
    options,
    eligibility: {
      doorFieldId: doorField.id,
      doorFieldName: doorField.name,
      brandFieldId: brandField.id,
      brandFieldName: brandField.name,
      doorOptionLabel,
      jobQualified,
      alreadyTagged,
      options: options.map(({ fieldId, fieldName, value, tempId }) => ({
        fieldId,
        fieldName,
        value,
        tempId,
      })),
      userUpdates,
      brands: brandPlans.map((brand) => {
        const userIds = [...(eligibleByBrand.get(brand.key) || [])].sort(
          (a, b) => a - b,
        );
        return {
          key: brand.key,
          title: brand.title,
          groupName: brand.groupName,
          optionLabel: brand.optionLabel,
          userIds,
          people: userIds.map((userId) => {
            const user = users.find((item) => Number(item.userId) === userId);
            return {
              userId,
              label: user
                ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
                : `User ${userId}`,
            };
          }),
        };
      }),
    },
  };
}

function stableIds(values) {
  return JSON.stringify(values);
}

export function realizeOptionIds(value, optionMap) {
  if (Array.isArray(value))
    return value.map((item) => realizeOptionIds(item, optionMap));
  if (value && typeof value === "object") {
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "optionIds" && Array.isArray(item))
        next[key] = item.map((id) =>
          optionMap.has(id) ? optionMap.get(id) : id,
        );
      else if (key === "after" && Array.isArray(item))
        next[key] = item.map((id) =>
          optionMap.has(id) ? optionMap.get(id) : id,
        );
      else next[key] = realizeOptionIds(item, optionMap);
    }
    return next;
  }
  return value;
}
