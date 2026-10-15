INSERT INTO courses (subject, year_min, year_max, price_minor, currency)
VALUES
  ('Maths', 5, 13, 19900, 'GBP'),
  ('English', 5, 13, 19900, 'GBP'),
  ('Science', 5, 11, 19900, 'GBP')
ON CONFLICT (subject) DO UPDATE SET
  year_min = EXCLUDED.year_min,
  year_max = EXCLUDED.year_max,
  price_minor = EXCLUDED.price_minor,
  currency = EXCLUDED.currency;

INSERT INTO lessons (course_id, position, title, body)
SELECT course.id, lesson.position, lesson.title, lesson.body
FROM courses AS course
JOIN (VALUES
  ('Maths', 1, 'Number patterns', 'Explore sequences and discover the rules behind them.'),
  ('Maths', 2, 'Fractions', 'Compare fractions and represent them on a number line.'),
  ('Maths', 3, 'Shapes and angles', 'Identify common shapes and measure their angles.'),
  ('English', 1, 'Reading for meaning', 'Use clues in a text to understand its main ideas.'),
  ('English', 2, 'Building vocabulary', 'Use context to learn and apply new words.'),
  ('English', 3, 'Writing a clear paragraph', 'Organize a main idea and supporting details.'),
  ('Science', 1, 'Working scientifically', 'Ask questions and plan a fair investigation.'),
  ('Science', 2, 'Materials around us', 'Compare the properties of everyday materials.'),
  ('Science', 3, 'Living things', 'Explore how living things depend on their habitats.')
) AS lesson(subject, position, title, body) ON lesson.subject = course.subject
ON CONFLICT (course_id, position) DO UPDATE SET
  title = EXCLUDED.title,
  body = EXCLUDED.body;
