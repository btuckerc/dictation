use crate::settings::WordReplacement;
use regex::Regex;
use std::collections::HashSet;
use std::sync::LazyLock;

pub fn normalize_rules(mut rules: Vec<WordReplacement>) -> Result<Vec<WordReplacement>, String> {
    let mut sources = HashSet::with_capacity(rules.len());
    for rule in &mut rules {
        rule.from = rule.from.trim().to_owned();
        rule.to = rule.to.trim().to_owned();
        if rule.from.is_empty() || rule.to.is_empty() {
            return Err("Replacement terms cannot be blank".to_owned());
        }
        if !sources.insert(rule.from.to_lowercase()) {
            return Err(format!("Duplicate replacement: {}", rule.from));
        }
    }
    Ok(rules)
}

/// Apply literal, case-insensitive whole-word replacements in one pass.
/// Rules are selected by earliest match, then longest source; replacements never cascade.
pub fn apply_replacements(input: &str, rules: &[WordReplacement]) -> String {
    let mut compiled = Vec::new();
    for rule in rules {
        if rule.from.is_empty() {
            continue;
        }
        if let Ok(regex) = Regex::new(&format!("(?iu){}", regex::escape(&rule.from))) {
            compiled.push((rule, regex));
        }
    }
    if compiled.is_empty() {
        return input.to_string();
    }
    let mut out = String::with_capacity(input.len());
    let mut cursor = 0;
    while cursor < input.len() {
        let mut best: Option<(usize, usize, usize)> = None;
        for (index, (_, regex)) in compiled.iter().enumerate() {
            let mut search_from = cursor;
            while let Some(m) = regex.find_at(input, search_from) {
                let start = m.start();
                let end = m.end();
                let before = input[..start].chars().next_back();
                let after = input[end..].chars().next();
                if before.is_some_and(is_word_char) || after.is_some_and(is_word_char) {
                    // Advance one character, not past the match: a valid phrase
                    // may overlap an occurrence rejected at a word boundary.
                    search_from = start + input[start..].chars().next().map_or(1, char::len_utf8);
                    continue;
                }
                if best.is_none_or(|(best_start, best_end, _)| {
                    start < best_start || (start == best_start && end > best_end)
                }) {
                    best = Some((start, end, index));
                }
                break;
            }
        }
        let Some((start, end, index)) = best else {
            out.push_str(&input[cursor..]);
            break;
        };
        out.push_str(&input[cursor..start]);
        out.push_str(&compiled[index].0.to);
        cursor = end;
    }
    out
}

fn is_word_char(c: char) -> bool {
    static WORD_CHAR: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^\w$").expect("static Unicode word-character expression"));
    let mut bytes = [0; 4];
    WORD_CHAR.is_match(c.encode_utf8(&mut bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn r(from: &str, to: &str) -> WordReplacement {
        WordReplacement {
            from: from.into(),
            to: to.into(),
        }
    }

    #[test]
    fn boundaries_and_case() {
        assert_eq!(
            apply_replacements(
                "Two, TWO! twofold twosome _two two_ to too.\n two",
                &[r("two", "2")]
            ),
            "2, 2! twofold twosome _two two_ to too.\n 2"
        );
    }

    #[test]
    fn overlap_longest() {
        assert_eq!(
            apply_replacements(
                "New York, new job",
                &[r("new", "old"), r("new york", "NYC")]
            ),
            "NYC, old job"
        );
    }

    #[test]
    fn rejected_boundary_does_not_hide_overlapping_match() {
        assert_eq!(apply_replacements("xa a a", &[r("a a", "X")]), "xa X");
    }

    #[test]
    fn no_cascade() {
        assert_eq!(
            apply_replacements("a b", &[r("a", "b"), r("b", "c")]),
            "b c"
        );
    }

    #[test]
    fn literal_specials_and_verbatim_output() {
        assert_eq!(
            apply_replacements("A+B (a+b)", &[r("a+b", "$1 iPhone")]),
            "$1 iPhone ($1 iPhone)"
        );
    }

    #[test]
    fn unicode_boundaries() {
        assert_eq!(
            apply_replacements(
                "café caféine CAFÉ café\u{0301} café\u{093e}",
                &[r("CAFÉ", "tea")]
            ),
            "tea caféine tea café\u{0301} café\u{093e}"
        );
    }

    #[test]
    fn validate_rules_before_saving() {
        assert!(normalize_rules(vec![r(" ", "2")]).is_err());
        assert!(normalize_rules(vec![r("two", "\n")]).is_err());
        assert!(normalize_rules(vec![r(" Two ", "2"), r("two", "II")]).is_err());
        let rules = normalize_rules(vec![r(" two ", " 2 ")]).unwrap();
        assert_eq!(rules[0].from, "two");
        assert_eq!(rules[0].to, "2");
    }
}
