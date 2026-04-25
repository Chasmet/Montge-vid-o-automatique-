import { createRequire } from "module";

const require = createRequire(import.meta.url);
const multer = require("multer");

const probe = multer({ storage: multer.memoryStorage() });
const proto = Object.getPrototypeOf(probe);

const originalFields = proto.fields;
const originalArray = proto.array;
const originalSingle = proto.single;

function groupFilesByField(files) {
  const grouped = {};
  for (const file of Array.isArray(files) ? files : []) {
    const key = file?.fieldname || "file";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(file);
  }
  return grouped;
}

function makeAnyMiddleware(instance, shape = "grouped") {
  const anyMiddleware = instance.any();
  return function flexibleMulterMiddleware(req, res, next) {
    anyMiddleware(req, res, function onAnyDone(error) {
      if (error) return next(error);

      if (shape === "grouped") {
        req.files = groupFilesByField(req.files);
      }

      if (shape === "single") {
        const list = Array.isArray(req.files) ? req.files : [];
        req.file = list[0] || undefined;
        req.files = list;
      }

      return next();
    });
  };
}

proto.fields = function patchedFields(fields) {
  try {
    return makeAnyMiddleware(this, "grouped");
  } catch {
    return originalFields.call(this, fields);
  }
};

proto.array = function patchedArray(fieldname, maxCount) {
  try {
    return makeAnyMiddleware(this, "array");
  } catch {
    return originalArray.call(this, fieldname, maxCount);
  }
};

proto.single = function patchedSingle(fieldname) {
  try {
    return makeAnyMiddleware(this, "single");
  } catch {
    return originalSingle.call(this, fieldname);
  }
};

console.log("Multer flexible actif : champs fichiers acceptés sans Unexpected field.");
