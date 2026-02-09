interface CategoryFilterProps {
  categories: string[];
  selected: string;
  onSelect: (category: string) => void;
}

export function CategoryFilter({
  categories,
  selected,
  onSelect,
}: CategoryFilterProps) {
  return (
    <div className="category-filter">
      <button
        className={`filter-btn ${selected === "All" ? "active" : ""}`}
        onClick={() => onSelect("All")}
      >
        All
      </button>
      {categories.map((cat) => (
        <button
          key={cat}
          className={`filter-btn ${selected === cat ? "active" : ""}`}
          onClick={() => onSelect(cat)}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}
