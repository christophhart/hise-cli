// Decode XML entities in attribute values. fast-xml-parser does not decode
// numeric character references like &#13;&#10; inside attributes; HISE writes
// these between macro lines in ExtraDefinitions* slots, so we decode after.

export function decodeXmlEntities(s: string): string {
	return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, ent) => {
		if (ent === "amp") return "&";
		if (ent === "lt") return "<";
		if (ent === "gt") return ">";
		if (ent === "quot") return "\"";
		if (ent === "apos") return "'";
		if (ent.startsWith("#x")) return String.fromCodePoint(parseInt(ent.slice(2), 16));
		return String.fromCodePoint(parseInt(ent.slice(1), 10));
	});
}
